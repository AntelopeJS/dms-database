import type { RequestContext } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import type { InstanceId, Stream } from "@antelopejs/interface-database";
import type { Database } from "./database";
import { getDeclaredFieldOrder, getDeclaredFieldTypes } from "./declaredFields";
import type { FieldDescriptor } from "./fieldDescriptor";
import { hasInstances } from "./introspect";
import {
  isBigInt,
  isBoolean,
  isFunction,
  isNumber,
  isObject,
  isString,
  isSymbol,
} from "../utils/guards";
import {
  applyFilterToList,
  cellToText,
  clamp,
  decodeInstanceFilter,
  normalizeSortDirection,
  parseInteger,
  type SortDirection,
  unwrapIsFilter,
} from "../utils/query";

/** Rows a page holds when the request names no `limit`. */
export const DEFAULT_LIMIT = 25;
/** The most rows a page holds. */
export const MAX_LIMIT = 200;

/**
 * Rows sampled by `/columns` to union column names and infer coarse types; a
 * small cap bounds schema inference without limiting query results.
 */
const COLUMN_SAMPLE_SIZE = 10;
/**
 * Selection filters are handled by resolveSelection; every other
 * `filter_<col>` is treated as a per-column data filter.
 */
const SELECTION_FILTER_KEYS = new Set([
  "filter_schema",
  "filter_table",
  "filter_instance",
]);

export interface BrowseSelection {
  schema: string;
  instance: InstanceId | undefined;
  table: string;
}

export interface ColumnFilter {
  /** Column accessor key. */
  field: string;
  /** Raw `<mode>:<value>` token, decoded by parseFilter (modes: is, contains). */
  raw: string;
}

export interface BrowseQuery extends BrowseSelection {
  offset: number;
  limit: number;
  sortKey?: string;
  sortDirection: SortDirection;
  search?: string;
  columnFilters: ColumnFilter[];
}

/**
 * Free-text search across every cell of a row (case-insensitive substring),
 * mirroring what the table view's search box implies.
 */
function searchRows<Row extends object>(rows: Row[], search: string): Row[] {
  const needle = search.toLowerCase();
  return rows.filter((row) =>
    Object.values(row).some((value) =>
      cellToText(value).toLowerCase().includes(needle),
    ),
  );
}

/** Read every `filter_<col>` query parameter that is not a selection filter. */
export function readColumnFilters(ctx: RequestContext): ColumnFilter[] {
  const filters: ColumnFilter[] = [];
  for (const [key, value] of ctx.url.searchParams) {
    if (!key.startsWith("filter_") || SELECTION_FILTER_KEYS.has(key)) continue;
    if (!value) continue;
    filters.push({ field: key.slice("filter_".length), raw: value });
  }
  return filters;
}

/**
 * Reads a page request from the browse query parameters: `filter_schema`,
 * `filter_instance` and `filter_table` select the table, then `offset`,
 * `limit`, `sortKey`, `sortDirection`, `search` and each `filter_<column>`.
 *
 * @param ctx The request
 * @returns The page to read
 */
export function readBrowseQuery(ctx: RequestContext): BrowseQuery {
  const params = ctx.url.searchParams;
  const read = (name: string) => params.get(name) ?? undefined;
  const sortKey = read("sortKey");
  const search = read("search");
  return {
    ...resolveSelection(
      read("filter_schema"),
      read("filter_instance"),
      read("filter_table"),
    ),
    offset: Math.max(0, parseInteger(read("offset"), 0)),
    limit: clamp(parseInteger(read("limit"), DEFAULT_LIMIT), 1, MAX_LIMIT),
    sortKey: sortKey || undefined,
    sortDirection: normalizeSortDirection(read("sortDirection")),
    search: search || undefined,
    columnFilters: readColumnFilters(ctx),
  };
}

export function resolveSelection(
  schemaFilter: string | undefined,
  instanceFilter: string | undefined,
  tableFilter: string | undefined,
): BrowseSelection {
  const schema = unwrapIsFilter(schemaFilter);
  const table = unwrapIsFilter(tableFilter);
  assert(schema, 400, "Missing 'schema' filter");
  assert(table, 400, "Missing 'table' filter");
  return {
    schema,
    instance: decodeInstanceFilter(instanceFilter),
    table,
  };
}

/**
 * Refuses an instance, named or every one, on a database whose tables have
 * none: the console reads an external database in its default instance.
 *
 * @param db The database read
 * @param instance The instance the request names
 */
export function assertDefaultInstance(
  db: Database,
  instance: InstanceId | undefined,
): void {
  assert(
    instance === undefined || hasInstances(db),
    400,
    `${db.connection} has no instances: read its tables without one`,
  );
}

export function resolveTable(db: Database, selection: BrowseSelection) {
  assertDefaultInstance(db, selection.instance);
  const schema = db.schemas().get(selection.schema);
  assert(schema, 404, `Unknown schema: ${selection.schema}`);
  assert(
    isObject(schema.definition) &&
      Object.hasOwn(schema.definition, selection.table),
    404,
    `Unknown table: ${selection.table}`,
  );
  return schema.instance(selection.instance).table(selection.table);
}

/**
 * Streams the full selection to count exactly while retaining only this page.
 * Arbitrary JSON stringification and Unicode matching must retain JS
 * semantics.
 */
async function refinePage<Row extends object>(
  sorted: Stream<Row>,
  query: BrowseQuery,
) {
  const results: Row[] = [];
  let total = 0;
  for await (const row of sorted) {
    let matches = [row];
    for (const filter of query.columnFilters) {
      matches = applyFilterToList(matches, filter.field, filter.raw);
    }
    if (query.search) matches = searchRows(matches, query.search);
    if (matches.length === 0) continue;
    if (total >= query.offset && results.length < query.limit)
      results.push(row);
    total++;
  }
  return { results, total };
}

/**
 * Without a search or a column filter the store handles ordering, pagination
 * and the count. With no sort picked, rows follow the primary key ascending,
 * whatever the direction: a store returns unordered rows in its own order,
 * which an update can change, so offset pages would move an edited row or
 * repeat and skip rows. The primary key is surfaced so the data browser knows
 * which column identifies a row when the user edits it.
 */
export async function fetchRows(db: Database, query: BrowseQuery) {
  const table = resolveTable(db, query);
  const primaryKey = db.primaryKey(query.schema, query.table);
  const sorted = query.sortKey
    ? table.orderBy(query.sortKey, query.sortDirection)
    : primaryKey
      ? table.orderBy(primaryKey)
      : table;

  const hasRefine = Boolean(query.search) || query.columnFilters.length > 0;
  if (!hasRefine) {
    const sliced = sorted.slice(query.offset, query.limit);
    const [results, total] = await Promise.all([
      sliced.run(),
      table.count().run(),
    ]);
    return {
      results,
      total,
      offset: query.offset,
      limit: query.limit,
      primaryKey,
    };
  }

  const { results, total } = await refinePage(sorted, query);
  return {
    results,
    total,
    offset: query.offset,
    limit: query.limit,
    primaryKey,
  };
}

export async function fetchTotal(
  db: Database,
  selection: BrowseSelection,
): Promise<number> {
  const table = resolveTable(db, selection);
  return table.count().run();
}

interface ColumnsMeta {
  columns: string[];
  types: Record<string, string>;
}

/**
 * Samples a handful of rows instead of one: on schemaless stores a null (or
 * absent) cell in the first row would otherwise hide the column's real type,
 * giving the data browser the wrong header icon and making it coerce a filled
 * NULL cell to the wrong type. A declared field type wins over the sample, since
 * a store may read a value back in another shape (a `Date` as an ISO string on
 * PostgreSQL). A Map keeps prototype-named columns
 * (`constructor`, `toString`, …) from vanishing: on a plain object
 * `key in types` / `types[key]` would hit Object.prototype and silently skip
 * them. Declared fields come first, in the Schemas inspector's order: a store
 * may return a row's keys in its own order (PostgreSQL's jsonb sorts them
 * shortest first).
 */
export async function fetchColumns(
  db: Database,
  selection: BrowseSelection,
): Promise<ColumnsMeta> {
  const table = resolveTable(db, selection);
  const sample: unknown[] = await table.slice(0, COLUMN_SAMPLE_SIZE).run();
  const columns: string[] = [];
  const typeByColumn = new Map<string, string>();
  for (const row of sample) {
    if (!isObject(row)) continue;
    for (const [key, cell] of Object.entries(row)) {
      const type = jsTypeOf(cell);
      const known = typeByColumn.get(key);
      if (known === undefined) {
        columns.push(key);
        typeByColumn.set(key, type);
      } else if (
        (known === "null" || known === "undefined") &&
        type !== "null" &&
        type !== "undefined"
      ) {
        typeByColumn.set(key, type);
      }
    }
  }
  const declared = getDeclaredFieldTypes(
    db,
    selection.schema,
    selection.table,
    columns,
  );
  for (const column of columns) {
    const descriptor = declared.get(column);
    const type = descriptor && gridTypeOf(descriptor);
    if (type) typeByColumn.set(column, type);
  }
  const ordered = getDeclaredFieldOrder(
    db,
    selection.schema,
    selection.table,
  ).filter((name) => typeByColumn.has(name));
  const extra = columns.filter((name) => !ordered.includes(name));
  return {
    columns: [...ordered, ...extra],
    types: Object.fromEntries(typeByColumn),
  };
}

const GRID_TYPE_BY_KIND = new Map<FieldDescriptor["kind"], string>([
  ["string", "string"],
  ["number", "number"],
  ["boolean", "boolean"],
  ["date", "date"],
  ["array", "array"],
  ["tuple", "array"],
  ["object", "object"],
  ["record", "object"],
]);

/**
 * The grid label of a declared type, or undefined when the declaration does
 * not settle one (a union, `any`, `unknown`) and the sample decides.
 */
function gridTypeOf(descriptor: FieldDescriptor): string | undefined {
  if (descriptor.kind === "refinement") return gridTypeOf(descriptor.base);
  return GRID_TYPE_BY_KIND.get(descriptor.kind);
}

/**
 * Coarse runtime type of a sampled cell. The data browser uses it to pick the
 * column header icon and to keep a NULL cell's column type when the user fills
 * it in (so a number/boolean column is not silently turned into a string);
 * editability itself does not depend on the type.
 */
function jsTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (value instanceof Date) return "date";
  if (Array.isArray(value)) return "array";
  if (isString(value)) return "string";
  if (isNumber(value)) return "number";
  if (isBoolean(value)) return "boolean";
  if (isBigInt(value)) return "bigint";
  if (isSymbol(value)) return "symbol";
  if (isFunction(value)) return "function";
  return "object";
}
