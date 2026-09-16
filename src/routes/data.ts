import {
  Context,
  Controller,
  Get,
  JSONBody,
  Parameter,
  Put,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import {
  CROSS_INSTANCE,
  type InstanceId,
  Schema,
  type Stream,
} from "@antelopejs/interface-database";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { getTablePrimaryKey } from "../service/introspect";
import {
  applyFilterToList,
  asNonEmptyString,
  cellToText,
  clamp,
  decodeInstanceFilter,
  normalizeSortDirection,
  parseInteger,
  type SortDirection,
  unwrapIsFilter,
} from "../utils/query";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
// Rows sampled by `/columns` to union column names and infer coarse types; a
// small cap bounds schema inference without limiting query results.
const COLUMN_SAMPLE_SIZE = 10;
// Selection filters are handled by resolveSelection; every other `filter_<col>` is
// treated as a per-column data filter.
const SELECTION_FILTER_KEYS = new Set([
  "filter_schema",
  "filter_table",
  "filter_instance",
]);

interface BrowseSelection {
  schema: string;
  instance: InstanceId | undefined;
  table: string;
}

interface ColumnFilter {
  // Column accessor key.
  field: string;
  // Raw `<mode>:<value>` token, decoded by parseFilter (modes: is, contains).
  raw: string;
}

interface BrowseQuery extends BrowseSelection {
  offset: number;
  limit: number;
  sortKey?: string;
  sortDirection: SortDirection;
  search?: string;
  columnFilters: ColumnFilter[];
}

// Free-text search across every cell of a row (case-insensitive substring),
// mirroring what the table view's search box implies.
function searchRows(
  rows: Record<string, unknown>[],
  search: string,
): Record<string, unknown>[] {
  const needle = search.toLowerCase();
  return rows.filter((row) =>
    Object.values(row).some((value) =>
      cellToText(value).toLowerCase().includes(needle),
    ),
  );
}

// Read every `filter_<col>` query parameter that is not a selection filter.
function readColumnFilters(ctx: RequestContext): ColumnFilter[] {
  const filters: ColumnFilter[] = [];
  for (const [key, value] of ctx.url.searchParams) {
    if (!key.startsWith("filter_") || SELECTION_FILTER_KEYS.has(key)) continue;
    if (!value) continue;
    filters.push({ field: key.slice("filter_".length), raw: value });
  }
  return filters;
}

function resolveSelection(
  schemaFilter: unknown,
  instanceFilter: unknown,
  tableFilter: unknown,
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

function resolveTable(selection: BrowseSelection) {
  const schema = Schema.get(selection.schema);
  assert(schema, 404, `Unknown schema: ${selection.schema}`);
  const definition = schema.definition[selection.table];
  assert(definition, 404, `Unknown table: ${selection.table}`);
  return schema.instance(selection.instance).table(selection.table as never);
}

async function refinePage(
  sorted: Stream<Record<string, unknown>>,
  query: BrowseQuery,
) {
  const results: Record<string, unknown>[] = [];
  let total = 0;
  // Arbitrary JSON stringification and Unicode matching must retain JS semantics.
  // Stream the full selection to count exactly while retaining only this page.
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

async function fetchRows(query: BrowseQuery) {
  const table = resolveTable(query);
  const sorted = query.sortKey
    ? table.orderBy(query.sortKey, query.sortDirection)
    : table;
  // Surfaced so the data browser knows which column identifies a row when the
  // user edits it.
  const primaryKey = getTablePrimaryKey(query.schema, query.table);

  const hasRefine = Boolean(query.search) || query.columnFilters.length > 0;
  if (!hasRefine) {
    // Fast path: the store handles ordering, pagination and the count.
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

async function fetchTotal(selection: BrowseSelection): Promise<number> {
  const table = resolveTable(selection);
  return table.count();
}

interface ColumnsMeta {
  columns: string[];
  types: Record<string, string>;
}

async function fetchColumns(selection: BrowseSelection): Promise<ColumnsMeta> {
  const table = resolveTable(selection);
  // Sample a handful of rows instead of one: on schemaless stores a null (or
  // absent) cell in the first row would otherwise hide the column's real type,
  // giving the data browser the wrong header icon and making it coerce a filled
  // NULL cell to the wrong type.
  const sample = (await table.slice(0, COLUMN_SAMPLE_SIZE)) as unknown[];
  const columns: string[] = [];
  // A Map keeps prototype-named columns (`constructor`, `toString`, …) from
  // vanishing: on a plain object `key in types` / `types[key]` would hit
  // Object.prototype and silently skip them.
  const typeByColumn = new Map<string, string>();
  for (const row of sample) {
    if (!row || typeof row !== "object") continue;
    for (const [key, cell] of Object.entries(row as Record<string, unknown>)) {
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

// Coarse runtime type of a sampled cell. The data browser uses it to pick the
// column header icon and to keep a NULL cell's column type when the user fills
// it in (so a number/boolean column is not silently turned into a string);
// editability itself does not depend on the type.
function jsTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// Synthetic columns the browse layer surfaces but does not persist (e.g. the
// instance tag added to cross-instance reads). They must never be written back.
const SYNTHETIC_FIELDS = new Set(["_instance"]);
// Always-read-only identity columns. `_id` is the conventional immutable primary
// key; it is protected here even when the table's primary key cannot be resolved
// (getTablePrimaryKey returns undefined), so a form can never rewrite a row's id.
const READONLY_FIELDS = new Set(["_id"]);

// Turn a form-submitted edit body (a map of field → new value) into a sanitised
// update set. The data browser edits one cell at a time, so the body usually
// holds a single field. Kept out of the update set:
//   - cleared / untouched optional fields (null / undefined),
//   - the read-only primary key,
//   - synthetic browse-only fields,
//   - non-finite numbers, and
//   - cells whose submitted value still equals the stored one (an unchanged echo).
//
// Scalars compare by string form so a numeric cell rendered as text ("42" vs 42)
// is recognised as unchanged. Structured cells (the JSON editor) are accepted as
// JSON-serialisable objects/arrays, normalised through a JSON round-trip so
// dates, class instances and other exotic prototypes cannot sneak into the
// store; they compare by JSON.stringify.
// `object` is the contract: this round-trips anything non-primitive through
// JSON. The call site reaches it with `object` because the null and undefined
// cases returned earlier -- `typeof value === "object"` alone yields
// `object | null`. A narrower type here would only push an assertion up.
// oxlint-disable-next-line anti-slop/no-object-parameters
function normalizeJsonValue(value: object): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// Sentinel: the field must not be written (protected, unchanged, or invalid).
const SKIP_FIELD = Symbol("skip");

// Decide the value to persist for a single edited field, or SKIP_FIELD to drop
// the write.
function resolveEditValue(
  current: Record<string, unknown>,
  field: string,
  value: unknown,
  primaryKey: string | undefined,
): unknown {
  if (value === null || value === undefined) return SKIP_FIELD;
  if (field === primaryKey) return SKIP_FIELD;
  if (SYNTHETIC_FIELDS.has(field) || READONLY_FIELDS.has(field)) {
    return SKIP_FIELD;
  }
  if (typeof value === "object") {
    const normalized = normalizeJsonValue(value);
    if (normalized === null || typeof normalized !== "object") {
      return SKIP_FIELD;
    }
    const before = current[field];
    if (
      before !== null &&
      typeof before === "object" &&
      sameJson(before, normalized)
    ) {
      return SKIP_FIELD;
    }
    return normalized;
  }
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return SKIP_FIELD;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return SKIP_FIELD;
  const before = current[field];
  // Skip cells echoed back unchanged. The string comparison also covers an
  // object cell echoed as its string form by a whole-row client ("1,2" for
  // [1, 2]): dropping that write protects the structured value from an
  // accidental destructive cast — deliberate structured edits go through the
  // object branch above.
  if (
    before !== null &&
    before !== undefined &&
    // "[object Object]" is not the point here: this compares the *client's*
    // string form of a cell ("1,2" for [1, 2]) against the stored value's,
    // which is what the comment above describes. JSON would defeat it.
    // Through cellToText, which also survives a stored cell whose own
    // `toString` is not callable -- the browser is schemaless, so a column
    // really can be named `toString`.
    cellToText(before) === cellToText(value)
  ) {
    return SKIP_FIELD;
  }
  return value;
}

function buildEditUpdates(
  current: Record<string, unknown>,
  body: Record<string, unknown>,
  primaryKey: string | undefined,
): Record<string, unknown> {
  // Null prototype so a field literally named `__proto__` (a column shape the
  // browse layer supports) creates a real own key instead of reparenting the
  // object — which would silently drop the edit while reporting success.
  const updates: Record<string, unknown> = Object.create(null);
  for (const [field, value] of Object.entries(body)) {
    const resolved = resolveEditValue(current, field, value, primaryKey);
    if (resolved !== SKIP_FIELD) updates[field] = resolved;
  }
  return updates;
}

@AuthOwnerOnly()
export class DatabaseBrowseController extends Controller(
  "/api/database/browse",
) {
  @Get("/list")
  // Each parameter is bound to a request input by its decorator, so
  // the framework hands them in positionally: an options object is not
  // expressible here.
  // oxlint-disable-next-line eslint/max-params
  async list(
    @AuthRawUser() _user: User,
    @Context() ctx: RequestContext,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
    @Parameter("filter_table", "query") tableFilter: unknown,
    @Parameter("offset", "query") offsetRaw: unknown,
    @Parameter("limit", "query") limitRaw: unknown,
    @Parameter("sortKey", "query") sortKey: unknown,
    @Parameter("sortDirection", "query") sortDirection: unknown,
    @Parameter("search", "query") searchRaw: unknown,
  ) {
    const selection = resolveSelection(
      schemaFilter,
      instanceFilter,
      tableFilter,
    );
    return fetchRows({
      ...selection,
      offset: Math.max(0, parseInteger(offsetRaw, 0)),
      limit: clamp(parseInteger(limitRaw, DEFAULT_LIMIT), 1, MAX_LIMIT),
      sortKey: asNonEmptyString(sortKey),
      sortDirection: normalizeSortDirection(sortDirection),
      search: asNonEmptyString(searchRaw),
      columnFilters: readColumnFilters(ctx),
    });
  }

  @Get("/count")
  async count(
    @AuthRawUser() _user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
    @Parameter("filter_table", "query") tableFilter: unknown,
  ) {
    const selection = resolveSelection(
      schemaFilter,
      instanceFilter,
      tableFilter,
    );
    return { total: await fetchTotal(selection) };
  }

  @Get("/columns")
  async columns(
    @AuthRawUser() _user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
    @Parameter("filter_table", "query") tableFilter: unknown,
  ) {
    const selection = resolveSelection(
      schemaFilter,
      instanceFilter,
      tableFilter,
    );
    const meta = await fetchColumns(selection);
    return {
      columns: meta.columns,
      // Coarse per-column runtime types. DataGrid — the only consumer of this
      // endpoint, which fetches `/columns` and `/list` itself in parallel —
      // uses them for header icons and to preserve a NULL cell's column type
      // on edit; they do not gate which columns are editable.
      types: meta.types,
      // Surfaced so DataGrid can resolve each row's id (falling back to `_id`)
      // and keep the primary-key column read-only.
      primaryKey: getTablePrimaryKey(selection.schema, selection.table) ?? null,
    };
  }

  @Get("/get")
  async get(
    @AuthRawUser() _user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
    @Parameter("filter_table", "query") tableFilter: unknown,
    @Parameter("id", "query") idRaw: unknown,
  ) {
    const selection = resolveSelection(
      schemaFilter,
      instanceFilter,
      tableFilter,
    );
    const id = asNonEmptyString(idRaw);
    assert(id, 400, "Missing 'id'");
    const table = resolveTable(selection);
    const row = await table.get(id as never);
    assert(row && typeof row === "object", 404, "Row not found");
    return row;
  }

  @Put("/edit")
  // Each parameter is bound to a request input by its decorator, so
  // the framework hands them in positionally: an options object is not
  // expressible here.
  // oxlint-disable-next-line eslint/max-params
  async edit(
    @AuthRawUser() _user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
    @Parameter("filter_table", "query") tableFilter: unknown,
    @Parameter("id", "query") idRaw: unknown,
    @JSONBody() body: Record<string, unknown>,
  ) {
    const selection = resolveSelection(
      schemaFilter,
      instanceFilter,
      tableFilter,
    );
    // Writes are scoped to a single instance: the cross-instance view is a
    // read-only union, so there is no unambiguous row to mutate.
    assert(
      selection.instance !== CROSS_INSTANCE,
      400,
      "Editing is disabled when browsing across all instances",
    );
    const id = asNonEmptyString(idRaw);
    assert(id, 400, "Missing 'id'");
    assert(
      body && typeof body === "object" && !Array.isArray(body),
      400,
      "Invalid request body",
    );

    const table = resolveTable(selection);
    // The selection object is reused, but the validation read and the write
    // still run as two separate queries: a row deleted between them makes the
    // update touch zero rows while the endpoint still echoes the merged row.
    const target = table.get(id as never);
    const existing = await target;
    assert(existing && typeof existing === "object", 404, "Row not found");
    const current = existing as Record<string, unknown>;
    const primaryKey = getTablePrimaryKey(selection.schema, selection.table);
    const updates = buildEditUpdates(current, body, primaryKey);
    if (Object.keys(updates).length > 0) {
      await target.update(updates as never).run();
    }
    // The values are validated and type-stable, so echo the merged row rather
    // than paying a second read.
    return { ...current, ...updates };
  }
}
