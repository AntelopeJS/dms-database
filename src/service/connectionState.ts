import { Logging } from "@antelopejs/interface-core/logging";
import { GetRuntimeInfo } from "@antelopejs/interface-core/runtime";
import type { RelationSummary } from "@antelopejs/interface-database-catalog";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { ConfigureModule } from "@antelopejs/interface-dms-builder";
import {
  type ConnectionAccess,
  GetConnectionAccess,
} from "@antelopejs/interface-dms/connection-access";
import { setExternalConnections, withAccess } from "../config";
import { configuredAccess } from "../connectionAccess";
import { builderRefusalReason } from "./builderRefusal";
import { REFUSALS, type RefusalSpec, refusal, refuse } from "./refusals";
import { ConnectionSelectionModel } from "../db/models/connection_selections.model";
import {
  type CatalogBinding,
  listExternalIds,
  listUnregisteredConnections,
  type MissingBinding,
  ownModuleId,
  resolveCatalog,
  resolveDatabase,
  resolveDeclaredCatalog,
  type UnregisteredConnection,
} from "./connections";
import { type Database, OWN_CONNECTION } from "./database";
import { TIMED_OUT, withDeadline } from "../utils/deadline";

/**
 * The console's features an external database does not offer: the console
 * neither migrates nor alters a database it does not own, its tables have no
 * instances, and the query console and a row's references read the project's
 * own schemas.
 */
export const EXTERNAL_UNSUPPORTED = [
  "migrations",
  "schemaEdits",
  "indexes",
  "queryConsole",
  "instances",
  "rowReferences",
] as const;

export type ConsoleFeature = (typeof EXTERNAL_UNSUPPORTED)[number];

const EXTERNAL_REFUSALS = {
  migrations: REFUSALS.externalMigrations,
  schemaEdits: REFUSALS.externalSchemaEdits,
  indexes: REFUSALS.externalIndexes,
  queryConsole: REFUSALS.externalQueryConsole,
  instances: REFUSALS.externalInstances,
  rowReferences: REFUSALS.externalRowReferences,
} as const satisfies Record<ConsoleFeature, RefusalSpec>;

/**
 * One database the console shows. The dashboard names the project's own
 * database from its locale; an external one is labelled by its connection
 * id, the name the project configuration and the builder give it.
 */
export interface ConnectionSummary {
  id: string;
  kind: "own" | "external";
  label: string;
  /** The database the catalog reports the connection is on; `null` for the own database and when the catalog refuses. */
  database: string | null;
  /** The engine the catalog reports; `null` for the own database and when the catalog refuses. */
  engine: string | null;
  /** What the project lets the console do; always `"read-write"` on the own database. */
  access: ConnectionAccess;
  /**
   * Whether the connection's account holds a write privilege on any relation
   * its catalog lists; `null` when the catalog does not answer.
   */
  canWrite: boolean | null;
  unsupported: ConsoleFeature[];
  /**
   * The bindings the project lacks for this connection on the dms-database entry; the console
   * lists it but cannot browse it until there are none.
   */
  missing: MissingBinding[];
}

/** The databases the console shows, the one the user browses, and whether access may change here. */
export interface ConnectionsState {
  selected: string;
  accessEditable: boolean;
  connections: ConnectionSummary[];
}

function grantsWrite({ writes }: RelationSummary): boolean {
  return writes.insert || writes.update || writes.delete;
}

/** The longest the switcher waits for one external catalog, in milliseconds. */
export const CATALOG_DEADLINE_MS = 3_000;

/**
 * Reads one catalog answer, or nothing when it fails or takes longer than
 * {@link CATALOG_DEADLINE_MS}: one slow or unreachable database never holds
 * up the others. The failure is logged on the server, never sent to the
 * browser, since a driver's message names the host and the account.
 */
async function catalogAnswer<T>(
  id: string,
  read: Promise<T>,
): Promise<T | undefined> {
  const answer = await withDeadline(
    read.catch((error: unknown) => {
      Logging.Warn(`[dms-database] the catalog of ${id} refused`, error);
      return undefined;
    }),
    CATALOG_DEADLINE_MS,
  );
  if (answer !== TIMED_OUT) return answer;
  Logging.Warn(`[dms-database] the catalog of ${id} did not answer in time`);
  return undefined;
}

async function summarizeCatalog(
  id: string,
  catalog: CatalogBinding,
  missing: MissingBinding[],
): Promise<ConnectionSummary> {
  const [info, relations] = await Promise.all([
    catalogAnswer(id, catalog.Info()),
    catalogAnswer(id, catalog.ListRelations()),
  ]);
  return {
    id,
    kind: "external",
    label: id,
    database: info?.database || null,
    engine: info?.engine ?? null,
    access: configuredAccess(id) ?? "read",
    canWrite: relations ? relations.some(grantsWrite) : null,
    unsupported: [...EXTERNAL_UNSUPPORTED],
    missing,
  };
}

function summarizeExternal(id: string): Promise<ConnectionSummary> {
  return summarizeCatalog(id, resolveCatalog(id), []);
}

async function summarizeUnregistered({
  id,
  missing,
}: UnregisteredConnection): Promise<ConnectionSummary> {
  if (missing.includes("catalog")) {
    return {
      id,
      kind: "external",
      label: id,
      database: null,
      engine: null,
      access: configuredAccess(id) ?? "read",
      canWrite: null,
      unsupported: [...EXTERNAL_UNSUPPORTED],
      missing,
    };
  }
  return summarizeCatalog(id, resolveDeclaredCatalog(id), missing);
}

const OWN_SUMMARY: ConnectionSummary = {
  id: OWN_CONNECTION,
  kind: "own",
  label: OWN_CONNECTION,
  database: null,
  engine: null,
  access: "read-write",
  canWrite: true,
  unsupported: [],
  missing: [],
};

/**
 * Whether access may change here: in development only. Elsewhere the project
 * files alone decide it, and a runtime that does not answer is not
 * development.
 */
async function accessEditable(): Promise<boolean> {
  const runtime = await GetRuntimeInfo().catch(() => undefined);
  return runtime?.dev === true;
}

/**
 * The connection a user browses: the one they picked while it still exists,
 * else the project's own database.
 *
 * @param userId The user's id
 * @returns The connection id
 */
async function selectedConnection(userId: string): Promise<string> {
  const picked = await GetModel(ConnectionSelectionModel).selectedBy(userId);
  return picked !== undefined && listExternalIds().includes(picked)
    ? picked
    : OWN_CONNECTION;
}

/** Whether a user browses an external database rather than the project's own. */
export async function browsesExternal(userId: string): Promise<boolean> {
  return (await selectedConnection(userId)) !== OWN_CONNECTION;
}

/** The database a user browses, which every page of the module reads. */
export async function resolveSelectedDatabase(
  userId: string,
): Promise<Database> {
  return resolveDatabase(await selectedConnection(userId));
}

/** The connections, the one a user browses, and whether access may change. */
export async function readConnectionsState(
  userId: string,
): Promise<ConnectionsState> {
  const [selected, editable, external, unregistered] = await Promise.all([
    selectedConnection(userId),
    accessEditable(),
    Promise.all(listExternalIds().map((id) => summarizeExternal(id))),
    Promise.all(listUnregisteredConnections().map(summarizeUnregistered)),
  ]);
  return {
    selected,
    accessEditable: editable,
    connections: [OWN_SUMMARY, ...external, ...unregistered],
  };
}

/** Records the database a user browses from now on. */
export async function selectConnection(
  userId: string,
  connection: string,
): Promise<void> {
  refuse(
    connection === OWN_CONNECTION || listExternalIds().includes(connection),
    REFUSALS.unknownConnection,
  );
  await GetModel(ConnectionSelectionModel).select(userId, connection);
}

/**
 * Changes an external connection's access on the owner's request, in
 * development only.
 *
 * @param connection The connection id
 * @param access The access to write
 */
export async function changeAccess(
  connection: string,
  access: ConnectionAccess,
): Promise<void> {
  assertExternal(connection);
  refuse(await accessEditable(), REFUSALS.notDevelopment);
  await writeAccess(connection, access);
}

function assertExternal(connection: string): void {
  refuse(connection !== OWN_CONNECTION, REFUSALS.ownDatabaseAccess);
  refuse(listExternalIds().includes(connection), REFUSALS.unknownConnection);
}

let accessWrites: Promise<unknown> = Promise.resolve();

/**
 * Writes an external connection's access to the project's configuration,
 * through the DMS's own configuration writer, then follows it. Writes run one
 * after the other, each from the settings the one before left, so two changes
 * in flight never write back each other's old value. A `"read-write"` access
 * needs an account that can write.
 *
 * @param connection The connection id
 * @param access The access to write
 */
export function writeAccess(
  connection: string,
  access: ConnectionAccess,
): Promise<void> {
  const write = accessWrites.then(() => writeAccessNow(connection, access));
  accessWrites = write.catch(() => undefined);
  return write;
}

async function writeAccessNow(
  connection: string,
  access: ConnectionAccess,
): Promise<void> {
  assertExternal(connection);
  if (access === "read-write") {
    const { canWrite } = await summarizeExternal(connection);
    refuse(canWrite !== null, REFUSALS.unverifiedAccount);
    refuse(canWrite, REFUSALS.readOnlyAccount);
  }
  const moduleId = ownModuleId();
  refuse(moduleId, REFUSALS.noModuleEntry);
  const next = withAccess(connection, access);
  const externalConnections = Object.fromEntries(
    Object.entries(next).map(([id, settings]) => [
      id,
      settings?.access === undefined ? {} : { access: settings.access },
    ]),
  );
  const written = await ConfigureModule(moduleId, {
    config: { externalConnections },
  }).catch(() => undefined);
  refuse(written !== undefined, REFUSALS.noBuilder);
  if (!written.ok) {
    throw refusal(REFUSALS.builderRefused, {
      reason: builderRefusalReason(written.error),
    });
  }
  setExternalConnections(next);
}

/**
 * Refuses a write the project does not allow on a database.
 *
 * @param db The database written to
 */
export async function assertWritable(db: Database): Promise<void> {
  if (db.connection === OWN_CONNECTION) return;
  if ((await GetConnectionAccess(db.connection)) !== "read-write") {
    throw refusal(REFUSALS.readOnlyConnection, { connection: db.connection });
  }
}

/**
 * Refuses a feature an external database does not offer.
 *
 * @param db The database the request reads
 * @param feature The feature it needs
 */
export function assertSupported(db: Database, feature: ConsoleFeature): void {
  refuse(db.connection === OWN_CONNECTION, EXTERNAL_REFUSALS[feature]);
}
