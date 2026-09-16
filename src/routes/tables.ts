import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import type { InstanceId } from "@antelopejs/interface-database";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  getTableElementCount,
  listSchemaSummaries,
} from "../service/introspect";
import {
  applyFilterToList,
  applySearchToList,
  applySortToList,
  clamp,
  decodeInstanceFilter,
  parseInteger,
} from "../utils/query";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

interface TableRow {
  // Stable, globally-unique row id (`schema::name`): table names alone collide
  // across schemas, so this is what DmsTableView uses for row identity.
  id: string;
  schema: string;
  name: string;
  columnCount: number;
  indexCount: number;
  relationCount: number;
  elementCount: number;
}

async function listAllTables(instance?: InstanceId): Promise<TableRow[]> {
  const summaries = await listSchemaSummaries();
  const rows: TableRow[] = [];
  for (const summary of summaries) {
    // Element counts follow the requested instance (a named instance paired
    // with a schema it doesn't belong to safely counts 0). Default: base
    // instance.
    const counts = await Promise.all(
      summary.tables.map((table) =>
        getTableElementCount(summary.id, table.name, instance),
      ),
    );
    summary.tables.forEach((table, idx) => {
      rows.push({
        id: `${summary.id}::${table.name}`,
        schema: summary.id,
        name: table.name,
        columnCount: Object.keys(table.fields).length,
        indexCount: Object.keys(table.indexes).length,
        relationCount: (table.relations ?? []).length,
        elementCount: counts[idx] ?? 0,
      });
    });
  }
  return rows;
}

async function selectMatchingTables(
  schemaFilter: unknown,
  instanceFilter: unknown,
  search: unknown,
): Promise<TableRow[]> {
  const all = await listAllTables(decodeInstanceFilter(instanceFilter));
  const bySchema = applyFilterToList(all, "schema", schemaFilter);
  return applySearchToList(bySchema, "name", search);
}

@AuthOwnerOnly()
export class DatabaseTablesController extends Controller(
  "/api/database/tables",
) {
  @Get("/list")
  // Each parameter is bound to a request input by its decorator, so
  // the framework hands them in positionally: an options object is not
  // expressible here.
  // oxlint-disable-next-line eslint/max-params
  async list(
    @AuthRawUser() _user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
    @Parameter("search", "query") search: unknown,
    @Parameter("offset", "query") offsetRaw: unknown,
    @Parameter("limit", "query") limitRaw: unknown,
    @Parameter("sortKey", "query") sortKey: unknown,
    @Parameter("sortDirection", "query") sortDirection: unknown,
  ) {
    const matching = await selectMatchingTables(
      schemaFilter,
      instanceFilter,
      search,
    );
    const sorted = applySortToList(matching, sortKey, sortDirection);
    const offset = Math.max(0, parseInteger(offsetRaw, 0));
    const limit = clamp(parseInteger(limitRaw, DEFAULT_LIMIT), 1, MAX_LIMIT);
    return {
      results: sorted.slice(offset, offset + limit),
      total: sorted.length,
      offset,
      limit,
    };
  }

  @Get("/count")
  async count(
    @AuthRawUser() _user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
    @Parameter("search", "query") search: unknown,
  ) {
    return {
      total: (await selectMatchingTables(schemaFilter, instanceFilter, search))
        .length,
    };
  }
}
