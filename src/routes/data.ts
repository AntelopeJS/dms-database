import {
  Context,
  Controller,
  Get,
  JSONBody,
  Parameter,
  Put,
  type RequestContext,
} from "@antelopejs/interface-api";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  assertDefaultInstance,
  fetchColumns,
  fetchRows,
  fetchTotal,
  readBrowseQuery,
  resolveSelection,
  resolveTable,
} from "../service/browse";
import {
  assertSupported,
  assertWritable,
  resolveSelectedDatabase,
} from "../service/connectionState";
import {
  getTableElementCount,
  listSchemaSummaries,
} from "../service/introspect";
import { REFUSALS, refusal, refuse } from "../service/refusals";
import { listRowReferences, type RowReference } from "../service/references";
import { editRow } from "../service/rowEdit";
import type { JsonValue } from "../types/json";
import type { ListResult } from "../types/responses";
import {
  isNonEmptyString,
  isObject,
  isRecord,
  isString,
} from "../utils/guards";
import { decodeInstanceFilter, unwrapIsFilter } from "../utils/query";

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
  async list(@AuthRawUser() user: User, @Context() ctx: RequestContext) {
    return fetchRows(
      await resolveSelectedDatabase(user._id),
      readBrowseQuery(ctx),
    );
  }

  @Get("/count")
  async count(
    @AuthRawUser() user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
    @Parameter("filter_table", "query") tableFilter: unknown,
  ) {
    const selection = resolveSelection(
      isString(schemaFilter) ? schemaFilter : undefined,
      isString(instanceFilter) ? instanceFilter : undefined,
      isString(tableFilter) ? tableFilter : undefined,
    );
    const db = await resolveSelectedDatabase(user._id);
    return { total: await fetchTotal(db, selection) };
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
    @AuthRawUser() user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
    @Parameter("filter_table", "query") tableFilter: unknown,
  ) {
    const selection = resolveSelection(
      isString(schemaFilter) ? schemaFilter : undefined,
      isString(instanceFilter) ? instanceFilter : undefined,
      isString(tableFilter) ? tableFilter : undefined,
    );
    const db = await resolveSelectedDatabase(user._id);
    const meta = await fetchColumns(db, selection);
    return {
      columns: meta.columns,
      types: meta.types,
      primaryKey: db.primaryKey(selection.schema, selection.table) ?? null,
    };
  }

  /**
   * The tables of a schema with their row counts in the browsed instance,
   * for the data browser's table list.
   */
  @Get("/tables")
  async tables(
    @AuthRawUser() user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
  ): Promise<ListResult<BrowseTableEntry>> {
    const schemaId = unwrapIsFilter(
      isString(schemaFilter) ? schemaFilter : undefined,
    );
    refuse(schemaId, REFUSALS.missingParameter, { name: "filter_schema" });
    const instance = decodeInstanceFilter(
      isString(instanceFilter) ? instanceFilter : undefined,
    );
    const db = await resolveSelectedDatabase(user._id);
    assertDefaultInstance(db, instance);
    const summary = (await listSchemaSummaries(db)).find(
      (candidate) => candidate.id === schemaId,
    );
    refuse(summary, REFUSALS.unknownSchema, { schema: schemaId });
    const items = await Promise.all(
      summary.tables.map(async (table) => ({
        name: table.name,
        elementCount: await getTableElementCount(
          db,
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
    @AuthRawUser() user: User,
    @Parameter("filter_schema", "query") schemaFilter: unknown,
    @Parameter("filter_instance", "query") instanceFilter: unknown,
    @Parameter("filter_table", "query") tableFilter: unknown,
    @Parameter("id", "query") idRaw: unknown,
  ): Promise<ListResult<RowReference>> {
    const db = await resolveSelectedDatabase(user._id);
    assertSupported(db, "rowReferences");
    const selection = resolveSelection(
      isString(schemaFilter) ? schemaFilter : undefined,
      isString(instanceFilter) ? instanceFilter : undefined,
      isString(tableFilter) ? tableFilter : undefined,
    );
    refuse(
      selection.instance !== CROSS_INSTANCE,
      REFUSALS.crossInstanceReferences,
    );
    refuse(isNonEmptyString(idRaw), REFUSALS.missingParameter, { name: "id" });
    const id = idRaw;
    const row: unknown = await resolveTable(db, selection).get(id).run();
    refuse(isRecord(row), REFUSALS.rowNotFound);
    const items = await listRowReferences(
      db,
      selection.schema,
      selection.table,
      new Map(Object.entries(row)),
      selection.instance,
    );
    return { items };
  }

  @Get("/get")
  async get(
    @AuthRawUser() user: User,
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
    refuse(isNonEmptyString(idRaw), REFUSALS.missingParameter, { name: "id" });
    const id = idRaw;
    const table = resolveTable(
      await resolveSelectedDatabase(user._id),
      selection,
    );
    const row: unknown = await table.get(id).run();
    refuse(isObject(row), REFUSALS.rowNotFound);
    return row;
  }

  @Put("/edit")
  async edit(
    @AuthRawUser() user: User,
    @Context() ctx: RequestContext,
    @JSONBody() body: JsonValue | undefined,
  ) {
    const selection = readSelection(ctx);
    const id = readQueryText(ctx, "id");
    refuse(id !== undefined, REFUSALS.missingParameter, { name: "id" });
    refuse(isObject(body) && !Array.isArray(body), REFUSALS.editBody);
    const db = await resolveSelectedDatabase(user._id);
    const connection = readQueryText(ctx, "connection");
    refuse(connection !== undefined, REFUSALS.missingParameter, {
      name: "connection",
    });
    if (connection !== db.connection) {
      throw refusal(REFUSALS.staleDatabase);
    }
    await assertWritable(db);
    return editRow(db, selection, id, body);
  }
}
