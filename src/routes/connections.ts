import {
  Controller,
  Get,
  JSONBody,
  Parameter,
  Put,
} from "@antelopejs/interface-api";
import { Logging } from "@antelopejs/interface-core/logging";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type {
  RelationDescription,
  RelationSummary,
} from "@antelopejs/interface-database-catalog";
import {
  CATALOG_DEADLINE_MS,
  changeAccess,
  type ConnectionsState,
  readConnectionsState,
  selectConnection,
} from "../service/connectionState";
import { REFUSALS, refusal, refuse } from "../service/refusals";
import {
  referencesByTable,
  type RelationsByTable,
} from "../service/catalogReferences";
import { resolveCatalog } from "../service/connections";
import { TIMED_OUT, withDeadline } from "../utils/deadline";
import type { JsonValue } from "../types/json";
import type { ListResult } from "../types/responses";
import { isNonEmptyString, isObject } from "../utils/guards";
import { describeError } from "../utils/redact";
import { assertNonEmptyString } from "../utils/requestValidation";

/**
 * Reads a catalog, answering its refusal (outside development, say) or its
 * silence with a conflict. The driver's message stays in the server log, its
 * credentials masked: it names the host, the port and the account.
 */
async function readCatalog<T>(
  connection: string,
  read: () => Promise<T>,
): Promise<T> {
  const outcome = await withDeadline(
    read().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => {
        Logging.Warn(
          `[dms-database] the catalog of ${connection} refused`,
          describeError(error instanceof Error ? error : String(error)),
        );
        return { ok: false as const };
      },
    ),
    CATALOG_DEADLINE_MS,
  );
  if (outcome === TIMED_OUT) {
    throw refusal(REFUSALS.catalogTimedOut, { connection });
  }
  if (!outcome.ok) {
    throw refusal(REFUSALS.catalogRefused, { connection });
  }
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
    refuse(
      isObject(body) &&
        "connection" in body &&
        isNonEmptyString(body.connection),
      REFUSALS.selectionBody,
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
    refuse(
      isObject(body) &&
        "access" in body &&
        (body.access === "read" || body.access === "read-write"),
      REFUSALS.accessBody,
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
    refuse(isNonEmptyString(relation), REFUSALS.missingParameter, {
      name: "relation",
    });
    const catalog = resolveCatalog(connection);
    const listed = await readCatalog(connection, () => catalog.ListRelations());
    refuse(
      listed.some(({ schema, name }) => `${schema}.${name}` === relation),
      REFUSALS.unknownRelation,
      { relation },
    );
    const [description] = await readCatalog(connection, () =>
      catalog.DescribeRelations([relation]),
    );
    refuse(description, REFUSALS.unknownRelation, { relation });
    return description;
  }

  /**
   * The foreign keys the catalog reports out of each relation of a schema,
   * as the relation declarations the diagram draws.
   */
  @Get("/:connection/schemas/:schema/references")
  async references(
    @AuthRawUser() _user: User,
    @Parameter("connection", "param") connection: unknown,
    @Parameter("schema", "param") schema: unknown,
  ): Promise<{ tables: RelationsByTable }> {
    assertNonEmptyString(connection);
    refuse(isNonEmptyString(schema), REFUSALS.missingParameter, {
      name: "schema",
    });
    const catalog = resolveCatalog(connection);
    const listed = await readCatalog(connection, () => catalog.ListRelations());
    const names = listed
      .filter((summary) => summary.schema === schema)
      .map(({ name }) => `${schema}.${name}`);
    const described =
      names.length === 0
        ? []
        : await readCatalog(connection, () => catalog.DescribeRelations(names));
    return { tables: referencesByTable(described, listed) };
  }
}
