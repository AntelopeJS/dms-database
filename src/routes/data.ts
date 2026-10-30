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
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  fetchColumns,
  fetchRows,
  fetchTotal,
  readColumnFilters,
  resolveSelection,
  resolveTable,
} from "../service/browse";
import {
  getTableElementCount,
  getTablePrimaryKey,
  listSchemaSummaries,
} from "../service/introspect";
import { listRowReferences, type RowReference } from "../service/references";
import { buildEditUpdates } from "../service/rowEdit";
import type { ListResult } from "../types/responses";
import {
  isNonEmptyString,
  isObject,
  isRecord,
  isString,
} from "../utils/guards";
import {
  clamp,
  decodeInstanceFilter,
  normalizeSortDirection,
  parseInteger,
  unwrapIsFilter,
} from "../utils/query";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

/** One table of the data browser's list, counted in the browsed instance. */
interface BrowseTableEntry {
  name: string;
  elementCount: number;
}

@AuthOwnerOnly()
export class DatabaseBrowseController extends Controller(
  "/api/database/browse",
) {
  @Get("/list")
  // oxlint-disable-next-line eslint/max-params -- each parameter is bound to a request input by its decorator, so the framework hands them in positionally: an options object is not expressible here
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
      isString(schemaFilter) ? schemaFilter : undefined,
      isString(instanceFilter) ? instanceFilter : undefined,
      isString(tableFilter) ? tableFilter : undefined,
    );
    return fetchRows({
      ...selection,
      offset: Math.max(
        0,
        parseInteger(isString(offsetRaw) ? offsetRaw : undefined, 0),
      ),
      limit: clamp(
        parseInteger(isString(limitRaw) ? limitRaw : undefined, DEFAULT_LIMIT),
        1,
        MAX_LIMIT,
      ),
      sortKey: isNonEmptyString(sortKey) ? sortKey : undefined,
      sortDirection: normalizeSortDirection(
        isString(sortDirection) ? sortDirection : undefined,
      ),
      search: isNonEmptyString(searchRaw) ? searchRaw : undefined,
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
      isString(schemaFilter) ? schemaFilter : undefined,
      isString(instanceFilter) ? instanceFilter : undefined,
      isString(tableFilter) ? tableFilter : undefined,
    );
    return { total: await fetchTotal(selection) };
  }

  /**
   * `types` are coarse per-column runtime types. DataGrid, the only consumer
   * of this endpoint, which fetches `/columns` and `/list` itself in parallel,
   * uses them for header icons and to preserve a NULL cell's column type on
   * edit; they do not gate which columns are editable. `primaryKey` is
   * surfaced so DataGrid can resolve each row's id (falling back to `_id`) and
   * keep the primary-key column read-only.
   */
  @Get("/columns")
  async columns(
    @AuthRawUser() _user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
    @Parameter("filter_table", "query") tableFilter: unknown,
  ) {
    const selection = resolveSelection(
      isString(schemaFilter) ? schemaFilter : undefined,
      isString(instanceFilter) ? instanceFilter : undefined,
      isString(tableFilter) ? tableFilter : undefined,
    );
    const meta = await fetchColumns(selection);
    return {
      columns: meta.columns,
      types: meta.types,
      primaryKey: getTablePrimaryKey(selection.schema, selection.table) ?? null,
    };
  }

  /**
   * The tables of a schema with their row counts in the browsed instance,
   * for the data browser's table list.
   */
  @Get("/tables")
  async tables(
    @AuthRawUser() _user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
  ): Promise<ListResult<BrowseTableEntry>> {
    const schemaId = unwrapIsFilter(
      isString(schemaFilter) ? schemaFilter : undefined,
    );
    assert(schemaId, 400, "Missing 'schema' filter");
    const instance = decodeInstanceFilter(
      isString(instanceFilter) ? instanceFilter : undefined,
    );
    const summary = (await listSchemaSummaries()).find(
      (candidate) => candidate.id === schemaId,
    );
    assert(summary, 404, `Unknown schema: ${schemaId}`);
    const items = await Promise.all(
      summary.tables.map(async (table) => ({
        name: table.name,
        elementCount: await getTableElementCount(
          schemaId,
          table.name,
          instance,
        ),
      })),
    );
    return { items };
  }

  /** Rows of other tables pointing at one row, per relation column. */
  @Get("/references")
  async references(
    @AuthRawUser() _user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
    @Parameter("filter_table", "query") tableFilter: unknown,
    @Parameter("id", "query") idRaw: unknown,
  ): Promise<ListResult<RowReference>> {
    const selection = resolveSelection(
      isString(schemaFilter) ? schemaFilter : undefined,
      isString(instanceFilter) ? instanceFilter : undefined,
      isString(tableFilter) ? tableFilter : undefined,
    );
    assert(
      selection.instance !== CROSS_INSTANCE,
      400,
      "Pick one instance to read a row's references",
    );
    assert(isNonEmptyString(idRaw), 400, "Missing 'id'");
    const id = idRaw;
    const row: unknown = await resolveTable(selection).get(id);
    assert(isRecord(row), 404, "Row not found");
    const items = await listRowReferences(
      selection.schema,
      selection.table,
      row,
      selection.instance,
    );
    return { items };
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
      isString(schemaFilter) ? schemaFilter : undefined,
      isString(instanceFilter) ? instanceFilter : undefined,
      isString(tableFilter) ? tableFilter : undefined,
    );
    assert(isNonEmptyString(idRaw), 400, "Missing 'id'");
    const id = idRaw;
    const table = resolveTable(selection);
    const row = await table.get(id);
    assert(isObject(row), 404, "Row not found");
    return row;
  }

  /**
   * Writes are scoped to a single instance: the cross-instance view is a
   * read-only union, so there is no unambiguous row to mutate. The adapter
   * counts modified rows, not matches: zero can mean either a concurrent
   * deletion or an unchanged value, and only a read distinguishes them, so a
   * successful save of a row that no longer exists is never echoed. Otherwise
   * the values are validated and type-stable, so the merged row is echoed
   * rather than paying a second read.
   */
  @Put("/edit")
  // oxlint-disable-next-line eslint/max-params -- each parameter is bound to a request input by its decorator, so the framework hands them in positionally: an options object is not expressible here
  async edit(
    @AuthRawUser() _user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
    @Parameter("filter_table", "query") tableFilter: unknown,
    @Parameter("id", "query") idRaw: unknown,
    @JSONBody() body: Record<string, unknown>,
  ) {
    const selection = resolveSelection(
      isString(schemaFilter) ? schemaFilter : undefined,
      isString(instanceFilter) ? instanceFilter : undefined,
      isString(tableFilter) ? tableFilter : undefined,
    );
    assert(
      selection.instance !== CROSS_INSTANCE,
      400,
      "Editing is disabled when browsing across all instances",
    );
    assert(isNonEmptyString(idRaw), 400, "Missing 'id'");
    const id = idRaw;
    assert(isObject(body) && !Array.isArray(body), 400, "Invalid request body");

    const table = resolveTable(selection);
    const target = table.get(id);
    const existing: unknown = await target;
    assert(isRecord(existing), 404, "Row not found");
    const primaryKey = getTablePrimaryKey(selection.schema, selection.table);
    const updates = buildEditUpdates(existing, body, primaryKey);
    if (Object.keys(updates).length > 0) {
      const changed = await target.update(updates as never).run();
      if (changed === 0) {
        const persisted = await target;
        assert(isObject(persisted), 404, "Row not found");
        return persisted;
      }
    }
    return { ...existing, ...updates };
  }
}
