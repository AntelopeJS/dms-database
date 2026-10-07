import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { formatModifier, localeOf, type ServerLocale } from "../i18n/messages";
import {
  getTableElementCount,
  listSchemaSummaries,
} from "../service/introspect";
import type { TableSummary } from "../service/types";
import { applyFilterToList, asNonEmptyString } from "../utils/query";

/** One table of the Schemas page, as its source table view lists it. */
export interface TableSourceRow {
  // `schema::name`: table names alone collide across schemas.
  id: string;
  schema: string;
  name: string;
  elementCount: number;
  columnCount: number;
  indexCount: number;
  /** The tables this one points to, `schema.table` outside its schema. */
  relations: string[];
  modifiers: string[];
}

interface TableSourceResult {
  results: TableSourceRow[];
  total: number;
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
function matchesSearch(
  row: TableSourceRow,
  table: TableSummary,
  needle: string,
): boolean {
  if (row.name.toLowerCase().includes(needle)) return true;
  return Object.keys(table.fields).some((field) =>
    field.toLowerCase().includes(needle),
  );
}

export async function listTableSourceRows(
  locale: ServerLocale,
  search?: string,
): Promise<TableSourceRow[]> {
  const needle = search?.trim().toLowerCase();
  const summaries = await listSchemaSummaries();
  const rows: TableSourceRow[] = [];
  for (const summary of summaries) {
    const counts = await Promise.all(
      summary.tables.map((table) =>
        getTableElementCount(summary.id, table.name),
      ),
    );
    summary.tables.forEach((table, index) => {
      const row: TableSourceRow = {
        id: `${summary.id}::${table.name}`,
        schema: summary.id,
        name: table.name,
        elementCount: counts[index] ?? 0,
        columnCount: Object.keys(table.fields).length,
        indexCount: Object.keys(table.indexes ?? {}).length,
        relations: relationTargets(summary.id, table),
        modifiers: modifierNames(table, locale),
      };
      if (!needle || matchesSearch(row, table, needle)) rows.push(row);
    });
  }
  return rows;
}

@AuthOwnerOnly()
export class DatabaseTablesController extends Controller(
  "/api/database/tables",
) {
  /**
   * Every registered table, for the Schemas page's source table view: it
   * searches table and column names and filters on the schema; the browser
   * sorts and pages the rows.
   */
  @Get("/source")
  async source(
    @AuthRawUser() user: User,
    @Parameter("search", "query") search: unknown,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
  ): Promise<TableSourceResult> {
    const rows = await listTableSourceRows(
      localeOf(user),
      asNonEmptyString(search),
    );
    const results = applyFilterToList(rows, "schema", schemaFilter);
    return { results, total: results.length };
  }
}
