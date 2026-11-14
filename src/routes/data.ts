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
import type { JsonValue } from "../types/json";
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

/**
 * A query-string input as `@Parameter(name, "query")` reads it, kept only
 * when it is a non-empty string.
 */
function readQueryText(ctx: RequestContext, name: string): string | undefined {
  return ctx.url.searchParams.get(name) || undefined;
}

/** The schema, instance and table a browse request names in its query string. */
function readSelection(ctx: RequestContext) {
  return resolveSelection(
    readQueryText(ctx, "filter_schema"),
    readQueryText(ctx, "filter_instance"),
    readQueryText(ctx, "filter_table"),
  );
}

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
  async list(@AuthRawUser() _user: User, @Context() ctx: RequestContext) {
    return fetchRows({
      ...readSelection(ctx),
      offset: Math.max(0, parseInteger(readQueryText(ctx, "offset"), 0)),
      limit: clamp(
        parseInteger(readQueryText(ctx, "limit"), DEFAULT_LIMIT),
        1,
        MAX_LIMIT,
      ),
      sortKey: readQueryText(ctx, "sortKey"),
      sortDirection: normalizeSortDirection(
        readQueryText(ctx, "sortDirection"),
      ),
      search: readQueryText(ctx, "search"),
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
    const row: unknown = await resolveTable(selection).get(id).run();
    assert(isRecord(row), 404, "Row not found");
    const items = await listRowReferences(
      selection.schema,
      selection.table,
      new Map(Object.entries(row)),
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
    const row: unknown = await table.get(id).run();
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
  async edit(
    @AuthRawUser() _user: User,
    @Context() ctx: RequestContext,
    @JSONBody() body: JsonValue | undefined,
  ) {
    const selection = readSelection(ctx);
    assert(
      selection.instance !== CROSS_INSTANCE,
      400,
      "Editing is disabled when browsing across all instances",
    );
    const id = readQueryText(ctx, "id");
    assert(id !== undefined, 400, "Missing 'id'");
    assert(isObject(body) && !Array.isArray(body), 400, "Invalid request body");

    const table = resolveTable(selection);
    const target = table.get(id);
    const existing: unknown = await target.run();
    assert(isRecord(existing), 404, "Row not found");
    const primaryKey = getTablePrimaryKey(selection.schema, selection.table);
    const updates = buildEditUpdates(
      new Map(Object.entries(existing)),
      body,
      primaryKey,
    );
    if (Object.keys(updates).length > 0) {
      const changed = await target.update(updates).run();
      if (changed === 0) {
        const persisted: unknown = await target.run();
        assert(isObject(persisted), 404, "Row not found");
        return persisted;
      }
    }
    return { ...existing, ...updates };
  }
}
