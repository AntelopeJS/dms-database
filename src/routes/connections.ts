import {
  Controller,
  Get,
  JSONBody,
  Parameter,
  Put,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type {
  RelationDescription,
  RelationSummary,
} from "@antelopejs/interface-database-catalog";
import {
  changeAccess,
  type ConnectionsState,
  readConnectionsState,
  selectConnection,
} from "../service/connectionState";
import { resolveCatalog } from "../service/connections";
import type { JsonValue } from "../types/json";
import type { ListResult } from "../types/responses";
import { isNonEmptyString, isObject } from "../utils/guards";
import { assertNonEmptyString } from "../utils/requestValidation";

/** Reads a catalog, answering its refusal (outside development, say) as a conflict. */
async function readCatalog<T>(
  connection: string,
  read: () => Promise<T>,
): Promise<T> {
  const outcome = await read().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({
      ok: false as const,
      reason: error instanceof Error ? error.message : String(error),
    }),
  );
  assert(
    outcome.ok,
    409,
    `The catalog of ${connection} refused: ${outcome.ok ? "" : outcome.reason}`,
  );
  return outcome.value;
}

/**
 * The databases the console shows: the project's own and each external
 * connection, the one each user browses, and each external one's access.
 */
@AuthOwnerOnly()
export class DatabaseConnectionsController extends Controller(
  "/api/database/connections",
) {
  @Get("/")
  async list(@AuthRawUser() user: User): Promise<ConnectionsState> {
    return readConnectionsState(user._id);
  }

  /** Picks the database every page of the module reads for this user. */
  @Put("/selected")
  async select(
    @AuthRawUser() user: User,
    @JSONBody() body: JsonValue | undefined,
  ): Promise<ConnectionsState> {
    assert(
      isObject(body) &&
        "connection" in body &&
        isNonEmptyString(body.connection),
      400,
      "Expected { connection: string }",
    );
    await selectConnection(user._id, body.connection);
    return readConnectionsState(user._id);
  }

  /**
   * Writes an external connection's access to the project's configuration.
   * Development only; `"read-write"` needs an account that can write.
   */
  @Put("/:connection/access")
  async access(
    @AuthRawUser() user: User,
    @Parameter("connection", "param") connection: unknown,
    @JSONBody() body: JsonValue | undefined,
  ): Promise<ConnectionsState> {
    assertNonEmptyString(connection);
    assert(
      isObject(body) &&
        "access" in body &&
        (body.access === "read" || body.access === "read-write"),
      400,
      'Expected { access: "read" | "read-write" }',
    );
    await changeAccess(connection, body.access);
    return readConnectionsState(user._id);
  }

  /** The relations the connection's catalog lists. */
  @Get("/:connection/relations")
  async relations(
    @AuthRawUser() _user: User,
    @Parameter("connection", "param") connection: unknown,
  ): Promise<ListResult<RelationSummary>> {
    assertNonEmptyString(connection);
    const catalog = resolveCatalog(connection);
    return {
      items: await readCatalog(connection, () => catalog.ListRelations()),
    };
  }

  /** One relation as the catalog describes it: columns, indexes and references. */
  @Get("/:connection/relations/:relation")
  async relation(
    @AuthRawUser() _user: User,
    @Parameter("connection", "param") connection: unknown,
    @Parameter("relation", "param") relation: unknown,
  ): Promise<RelationDescription> {
    assertNonEmptyString(connection);
    assert(isNonEmptyString(relation), 400, "Missing relation");
    const catalog = resolveCatalog(connection);
    const listed = await readCatalog(connection, () => catalog.ListRelations());
    assert(
      listed.some(({ schema, name }) => `${schema}.${name}` === relation),
      404,
      `Unknown relation: ${relation}`,
    );
    const [description] = await readCatalog(connection, () =>
      catalog.DescribeRelations([relation]),
    );
    assert(description, 404, `Unknown relation: ${relation}`);
    return description;
  }
}
