import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { formatModifier, localeOf, type ServerLocale } from "../i18n/messages";
import {
  getTableElementCount,
  getTableRowCounts,
  getTableTotalCount,
  listSchemaInstances,
  listSchemaSummaries,
  type TableRowCounts,
} from "../service/introspect";
import {
  type InstanceChoice,
  readSchemaFilters,
  type SchemaFilters,
} from "../service/schemaFilters";
import { getRegistry } from "../service/schemaRegistry";
import type { TableSummary } from "../service/types";
import { asNonEmptyString, clamp, parseInteger } from "../utils/query";

/** One table of the Schemas page, as its source table view lists it. */
export interface TableSourceRow {
  // `schema::name`: table names alone collide across schemas.
  id: string;
  schema: string;
  name: string;
  /** Rows in the instance the filter bar picked; every instance by default. */
  elementCount: number;
  columnCount: number;
  indexCount: number;
  /** The tables this one points to, `schema.table` outside its schema. */
  relations: string[];
  modifiers: string[];
  // The filter bar's URL values, empty when unset: the Inspect action's URL
  // replaces the whole query, so it writes them back from the row.
  _scope: string;
  _instance: string;
  _q: string;
  _has: string;
}

interface TableSourceResult {
  results: TableSourceRow[];
  total: number;
  /** Registered tables before any filter, for the bar's "X of Y". */
  all: number;
}

interface InstancesResult {
  /** Named instances matching the search, sorted, at most `limit`. */
  instances: string[];
  /** Named instances matching the search. */
  total: number;
}

const INSTANCE_LIMIT_DEFAULT = 100;
const INSTANCE_LIMIT_MAX = 500;
const INSTANCES_TTL_MS = 30_000;
const instanceCollator = new Intl.Collator(undefined, { numeric: true });
const namedInstancesCache = new Map<
  string,
  { value: string[]; expiresAt: number }
>();

/**
 * A schema's named instances, kept a moment: the instance picker searches
 * them on each keystroke. Undefined for an unknown schema.
 */
async function listNamedInstances(
  schemaId: string,
): Promise<string[] | undefined> {
  const schema = getRegistry().get(schemaId);
  if (!schema) return undefined;
  const cached = namedInstancesCache.get(schemaId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await listSchemaInstances(schema);
  namedInstancesCache.set(schemaId, {
    value,
    expiresAt: now + INSTANCES_TTL_MS,
  });
  return value;
}

function relationTargets(schemaId: string, table: TableSummary): string[] {
  const targets = table.relations.map((relation) =>
    relation.toSchema === schemaId
      ? relation.toTable
      : `${relation.toSchema}.${relation.toTable}`,
  );
  return [...new Set(targets)];
}

function modifierNames(table: TableSummary, locale: ServerLocale): string[] {
  const ids = new Set(Object.values(table.modifiers).flat());
  return [...ids].map((id) => formatModifier(locale, id));
}

// A search names a table or one of its columns (D-06): "where is the
// invoice number" finds the table holding it.
function matchesSearch(table: TableSummary, needle: string): boolean {
  if (table.name.toLowerCase().includes(needle)) return true;
  return Object.keys(table.fields).some((field) =>
    field.toLowerCase().includes(needle),
  );
}

interface ListedTable {
  schemaId: string;
  table: TableSummary;
}

function needleOf(text: string | undefined): string | undefined {
  const needle = text?.trim().toLowerCase();
  return needle || undefined;
}

// What the bar filters on before any row is counted: a count per table may
// run across every instance.
function matchesStructure(
  { schemaId, table }: ListedTable,
  filters: SchemaFilters,
  needles: string[],
): boolean {
  if (filters.scope && schemaId !== filters.scope) return false;
  if (!needles.every((needle) => matchesSearch(table, needle))) return false;
  if (filters.has.includes("relations") && table.relations.length === 0)
    return false;
  if (
    filters.has.includes("modifiers") &&
    Object.values(table.modifiers).every((ids) => ids.length === 0)
  )
    return false;
  return true;
}

function countRows(
  schemaId: string,
  tableName: string,
  instance: InstanceChoice,
): Promise<number> {
  if (instance.kind === "all") return getTableTotalCount(schemaId, tableName);
  if (instance.kind === "default")
    return getTableElementCount(schemaId, tableName);
  return getTableElementCount(schemaId, tableName, instance.id);
}

export interface TableSourceListing {
  rows: TableSourceRow[];
  /** Registered tables before any filter. */
  all: number;
}

/**
 * The tables the Schemas page lists for its filter bar's state (and the
 * table view's own `search`, kept for older links): schema, search and
 * structure first, then the rows counted in the picked instance, then the
 * empty ones when asked.
 */
export async function listTableSourceRows(
  locale: ServerLocale,
  filters: SchemaFilters,
  search?: string,
): Promise<TableSourceListing> {
  const needles = [needleOf(filters.q), needleOf(search)].filter(
    (needle): needle is string => !!needle,
  );
  const summaries = await listSchemaSummaries();
  const registered: ListedTable[] = summaries.flatMap((summary) =>
    summary.tables.map((table) => ({ schemaId: summary.id, table })),
  );
  const tables = registered.filter((listed) =>
    matchesStructure(listed, filters, needles),
  );
  const counts = await Promise.all(
    tables.map(({ schemaId, table }) =>
      countRows(schemaId, table.name, filters.instance),
    ),
  );
  const rows = tables.map(({ schemaId, table }, index) => ({
    id: `${schemaId}::${table.name}`,
    schema: schemaId,
    name: table.name,
    elementCount: counts[index] ?? 0,
    columnCount: Object.keys(table.fields).length,
    indexCount: Object.keys(table.indexes ?? {}).length,
    relations: relationTargets(schemaId, table),
    modifiers: modifierNames(table, locale),
    _scope: filters.echo.scope,
    _instance: filters.echo.instance,
    _q: filters.echo.q,
    _has: filters.echo.has,
  }));
  return {
    rows: filters.has.includes("empty")
      ? rows.filter((row) => row.elementCount === 0)
      : rows,
    all: registered.length,
  };
}

/** A schema's named instances containing the search, sorted, at most `limit`. */
export function matchNamedInstances(
  instances: readonly string[],
  search: string | undefined,
  limit: number,
): InstancesResult {
  const needle = needleOf(search);
  const matches = [...new Set(instances)]
    .filter((id) => !needle || id.toLowerCase().includes(needle))
    .sort((left, right) => instanceCollator.compare(left, right));
  return { instances: matches.slice(0, limit), total: matches.length };
}

@AuthOwnerOnly()
export class DatabaseTablesController extends Controller(
  "/api/database/tables",
) {
  /**
   * Every registered table, for the Schemas page's source table view. The
   * page's filter bar narrows it (schema, instance, table or column name,
   * structure), through the hidden filters the view sends; the browser sorts
   * and pages the rows.
   */
  @Get("/source")
  // oxlint-disable-next-line eslint/max-params
  async source(
    @AuthRawUser() user: User,
    @Parameter("search", "query") search: unknown,
    @Parameter("filter_scope", "query") scope: unknown,
    @Parameter("filter_instance", "query") instance: unknown,
    @Parameter("filter_q", "query") q: unknown,
    @Parameter("filter_has", "query") has: unknown,
  ): Promise<TableSourceResult> {
    const { rows, all } = await listTableSourceRows(
      localeOf(user),
      readSchemaFilters({ scope, instance, q, has }),
      asNonEmptyString(search),
    );
    return { results: rows, total: rows.length, all };
  }

  /**
   * A schema's named instances for the filter bar's instance picker: a
   * schema may hold one per tenant, so it searches them here and lists at
   * most `limit`, with how many matched.
   */
  @Get("/instances")
  async instances(
    @Parameter("schema", "query") schemaRaw: unknown,
    @Parameter("search", "query") search: unknown,
    @Parameter("limit", "query") limitRaw: unknown,
  ): Promise<InstancesResult> {
    const schema = asNonEmptyString(schemaRaw);
    assert(schema, 400, "Missing 'schema'");
    const named = await listNamedInstances(schema);
    assert(named, 404, `Unknown schema ${schema}`);
    const limit = clamp(
      parseInteger(limitRaw, INSTANCE_LIMIT_DEFAULT),
      1,
      INSTANCE_LIMIT_MAX,
    );
    return matchNamedInstances(named, asNonEmptyString(search), limit);
  }

  /**
   * One table's rows, in all and per instance, for the Schemas page's
   * inspector: the default instance and the first named ones.
   */
  @Get("/counts")
  async counts(
    @Parameter("schema", "query") schemaRaw: unknown,
    @Parameter("table", "query") tableRaw: unknown,
  ): Promise<TableRowCounts> {
    const schema = asNonEmptyString(schemaRaw);
    const table = asNonEmptyString(tableRaw);
    assert(schema && table, 400, "Missing 'schema' or 'table'");
    const counts = await getTableRowCounts(schema, table);
    assert(counts, 404, `Unknown table ${schema}.${table}`);
    return counts;
  }
}
