import type { RequestContext } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import {
  CROSS_INSTANCE,
  type InstanceId,
} from "@antelopejs/interface-database";
import type { Database } from "./database";
import { getDeclaredFieldOrder, getDeclaredFieldTypes } from "./declaredFields";
import type { FieldDescriptor } from "./fieldDescriptor";
import { hasInstances } from "./introspect";
import {
  buildRowFilter,
  type ColumnFilter,
  NO_ROW,
  type RowMatch,
  readFilterMode,
} from "./rowFilter";
import type { StoredCell } from "../types/stored";
import { TIMED_OUT, withDeadline } from "../utils/deadline";
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
  clamp,
  decodeInstanceFilter,
  normalizeSortDirection,
  parseFilter,
  parseInteger,
  type SortDirection,
  unwrapIsFilter,
} from "../utils/query";

/** Rows a page holds when the request names no `limit`. */
export const DEFAULT_LIMIT = 25;
/** The most rows a page holds. */
export const MAX_LIMIT = 200;

/** The longest a page of an external database's rows may take, in milliseconds. */
export const EXTERNAL_PAGE_DEADLINE_MS = 10_000;

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

export interface BrowseQuery extends BrowseSelection {
  offset: number;
  limit: number;
  sortKey?: string;
  sortDirection: SortDirection;
  search?: string;
  columnFilters: ColumnFilter[];
}

/**
 * Reads every `filter_<col>` query parameter that is not a selection filter
 * as a `<mode>:<value>` token. A token with no mode compares with `is`, and a
 * token whose mode is not one the console knows is dropped.
 */
export function readColumnFilters(ctx: RequestContext): ColumnFilter[] {
  const filters: ColumnFilter[] = [];
  for (const [key, token] of ctx.url.searchParams) {
    if (!key.startsWith("filter_") || SELECTION_FILTER_KEYS.has(key)) continue;
    const parsed = parseFilter(token);
    const mode = parsed && readFilterMode(parsed.mode);
    if (!parsed || !mode) continue;
    filters.push({
      field: key.slice("filter_".length),
      mode,
      value: parsed.value,
    });
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
 * Refuses a sort or a filter on a column the table neither declares nor shows
 * in its rows: the column name goes to the database as it is.
 *
 * @param meta The table's columns
 * @param primaryKey The table's primary key
 * @param column The column asked for
 */
function assertKnownColumn(
  meta: ColumnsMeta,
  primaryKey: string | undefined,
  column: string,
): void {
  assert(
    meta.columns.includes(column) || column === primaryKey,
    400,
    `Unknown column: ${column}`,
  );
}

/**
 * Refuses a sort key or a column filter that names a column the table does
 * not have, then reads the search and the column filters as one condition on
 * a row. The columns are read once, and only when the page names one.
 */
async function resolvePageFilter(
  db: Database,
  query: BrowseQuery,
  primaryKey: string | undefined,
): Promise<RowMatch | undefined> {
  if (!query.sortKey && !query.search && query.columnFilters.length === 0) {
    return undefined;
  }
  const meta = await fetchColumns(db, query);
  if (query.sortKey) assertKnownColumn(meta, primaryKey, query.sortKey);
  for (const { field } of query.columnFilters) {
    assertKnownColumn(meta, primaryKey, field);
  }
  return buildRowFilter(meta, query.search, query.columnFilters);
}

/**
 * Waits for an external database's answer, at most
 * {@link EXTERNAL_PAGE_DEADLINE_MS}, and refuses with a 504 after that.
 */
async function answerInTime<T>(work: Promise<T>): Promise<T> {
  const answer = await withDeadline(work, EXTERNAL_PAGE_DEADLINE_MS);
  assert(
    answer !== TIMED_OUT,
    504,
    "The external database did not answer in time: narrow the search or try again",
  );
  return answer;
}

/**
 * A page of rows and the exact number of rows that match. The search and the
 * column filters run in the database's query, on the project's own database
 * and on an external one, and the total is the database's count of the
 * filtered rows. A search or a filter no row can satisfy answers an empty page
 * without querying the rows. With no sort picked, rows follow the primary key
 * ascending, whatever the direction: a store returns unordered rows in its own
 * order, which an update can change, so offset pages would move an edited row
 * or repeat and skip rows. The primary key is surfaced so the data browser
 * knows which column identifies a row when the user edits it. An external
 * database that does not answer within {@link EXTERNAL_PAGE_DEADLINE_MS} is
 * refused with a 504.
 */
export async function fetchRows(db: Database, query: BrowseQuery) {
  const table = resolveTable(db, query);
  const primaryKey = db.primaryKey(query.schema, query.table);
  const page = { offset: query.offset, limit: query.limit, primaryKey };
  const filter = await resolvePageFilter(db, query, primaryKey);
  if (filter === NO_ROW) return { results: [], total: 0, ...page };
  const refined = filter ? table.filter(filter) : table;
  const sorted = query.sortKey
    ? refined.orderBy(query.sortKey, query.sortDirection)
    : primaryKey
      ? refined.orderBy(primaryKey)
      : refined;
  const answered = Promise.all([
    sorted.slice(query.offset, query.limit).run(),
    refined.count().run(),
  ]);
  const [results, total] = await (hasInstances(db)
    ? answered
    : answerInTime(answered));
  return { results, total, ...page };
}

/**
 * The exact number of rows of a table. On an external database, which has no
 * instances, "every instance" is its default one, as the table inspector asks
 * for it, and the count is refused with a 504 when the database does not
 * answer within {@link EXTERNAL_PAGE_DEADLINE_MS}.
 */
export async function fetchTotal(
  db: Database,
  selection: BrowseSelection,
): Promise<number> {
  if (hasInstances(db)) return resolveTable(db, selection).count().run();
  const table = resolveTable(
    db,
    selection.instance === CROSS_INSTANCE
      ? { ...selection, instance: undefined }
      : selection,
  );
  return answerInTime(table.count().run());
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
function jsTypeOf(value: StoredCell): string {
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
