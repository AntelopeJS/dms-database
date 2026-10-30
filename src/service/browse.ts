import type { RequestContext } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import {
  type InstanceId,
  Schema,
  type Stream,
} from "@antelopejs/interface-database";
import { getTablePrimaryKey } from "./introspect";
import { isObject } from "../utils/guards";
import {
  applyFilterToList,
  cellToText,
  decodeInstanceFilter,
  type SortDirection,
  unwrapIsFilter,
} from "../utils/query";

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

export function resolveTable(selection: BrowseSelection) {
  const schema = Schema.get(selection.schema);
  assert(schema, 404, `Unknown schema: ${selection.schema}`);
  const definition = schema.definition[selection.table];
  assert(definition, 404, `Unknown table: ${selection.table}`);
  return schema.instance(selection.instance).table(selection.table);
}

/**
 * Streams the full selection to count exactly while retaining only this page.
 * Arbitrary JSON stringification and Unicode matching must retain JS
 * semantics.
 */
async function refinePage(
  sorted: Stream<Record<string, unknown>>,
  query: BrowseQuery,
) {
  const results: Record<string, unknown>[] = [];
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
 * and the count. The primary key is surfaced so the data browser knows which
 * column identifies a row when the user edits it.
 */
export async function fetchRows(query: BrowseQuery) {
  const table = resolveTable(query);
  const sorted = query.sortKey
    ? table.orderBy(query.sortKey, query.sortDirection)
    : table;
  const primaryKey = getTablePrimaryKey(query.schema, query.table);

  const hasRefine = Boolean(query.search) || query.columnFilters.length > 0;
  if (!hasRefine) {
    const sliced = sorted.slice(query.offset, query.limit);
    const [results, total] = await Promise.all([sliced, table.count()]);
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

export async function fetchTotal(selection: BrowseSelection): Promise<number> {
  const table = resolveTable(selection);
  return table.count();
}

interface ColumnsMeta {
  columns: string[];
  types: Record<string, string>;
}

/**
 * Samples a handful of rows instead of one: on schemaless stores a null (or
 * absent) cell in the first row would otherwise hide the column's real type,
 * giving the data browser the wrong header icon and making it coerce a filled
 * NULL cell to the wrong type. A Map keeps prototype-named columns
 * (`constructor`, `toString`, …) from vanishing: on a plain object
 * `key in types` / `types[key]` would hit Object.prototype and silently skip
 * them.
 */
export async function fetchColumns(
  selection: BrowseSelection,
): Promise<ColumnsMeta> {
  const table = resolveTable(selection);
  const sample: unknown[] = await table.slice(0, COLUMN_SAMPLE_SIZE);
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
  return { columns, types: Object.fromEntries(typeByColumn) };
}

/**
 * Coarse runtime type of a sampled cell. The data browser uses it to pick the
 * column header icon and to keep a NULL cell's column type when the user fills
 * it in (so a number/boolean column is not silently turned into a string);
 * editability itself does not depend on the type.
 */
function jsTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Date) return "date";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
