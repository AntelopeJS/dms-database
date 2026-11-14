import { assert } from "@antelopejs/interface-api-util";
import { GetRuntimeInfo } from "@antelopejs/interface-core/runtime";
import type { RelationSummary } from "@antelopejs/interface-database-catalog";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { ConfigureModule } from "@antelopejs/interface-dms-builder";
import type { ConnectionAccess } from "@antelopejs/interface-dms/connection-access";
import { setExternalConnections, withAccess } from "../config";
import { configuredAccess } from "../connectionAccess";
import { ConnectionSelectionModel } from "../db/models/connection_selections.model";
import {
  listExternalIds,
  ownModuleId,
  resolveCatalog,
  resolveDatabase,
} from "./connections";
import { type Database, OWN_CONNECTION } from "./database";

/**
 * The console's features an external database does not offer: the console
 * neither migrates nor alters a database it does not own, its tables have no
 * instances, and the diagram, the query console and a row's references read
 * the project's own schemas.
 */
export const EXTERNAL_UNSUPPORTED = [
  "migrations",
  "schemaEdits",
  "indexes",
  "diagram",
  "queryConsole",
  "instances",
  "rowReferences",
] as const;

export type ConsoleFeature = (typeof EXTERNAL_UNSUPPORTED)[number];

const FEATURE_NAMES: Record<ConsoleFeature, string> = {
  migrations: "Migrations",
  schemaEdits: "Schema edits",
  indexes: "Indexes",
  diagram: "The diagram",
  queryConsole: "The query console",
  instances: "Instances",
  rowReferences: "A row's references",
};

/** Why an edit made on a database the user no longer browses is refused. */
export const STALE_DATABASE =
  "The selected database changed in another tab: reload the page";

/** What the account behind a connection may not do, in the words the dashboard shows. */
export const READ_ONLY_ACCOUNT =
  "This account can only read. Use an account with write access to allow changes.";

/**
 * One database the console shows. The dashboard names the project's own
 * database from its locale; an external one is labelled by the database its
 * catalog reports, else by its connection id.
 */
export interface ConnectionSummary {
  id: string;
  kind: "own" | "external";
  label: string;
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

async function summarizeExternal(id: string): Promise<ConnectionSummary> {
  const catalog = resolveCatalog(id);
  const [info, relations] = await Promise.all([
    catalog.Info().catch(() => undefined),
    catalog.ListRelations().catch(() => undefined),
  ]);
  return {
    id,
    kind: "external",
    label: info?.database || id,
    engine: info?.engine ?? null,
    access: configuredAccess(id) ?? "read",
    canWrite: relations ? relations.some(grantsWrite) : null,
    unsupported: [...EXTERNAL_UNSUPPORTED],
  };
}

const OWN_SUMMARY: ConnectionSummary = {
  id: OWN_CONNECTION,
  kind: "own",
  label: OWN_CONNECTION,
  engine: null,
  access: "read-write",
  canWrite: true,
  unsupported: [],
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
  const [selected, editable, external] = await Promise.all([
    selectedConnection(userId),
    accessEditable(),
    Promise.all(listExternalIds().map((id) => summarizeExternal(id))),
  ]);
  return {
    selected,
    accessEditable: editable,
    connections: [OWN_SUMMARY, ...external],
  };
}

/** Records the database a user browses from now on. */
export async function selectConnection(
  userId: string,
  connection: string,
): Promise<void> {
  assert(
    connection === OWN_CONNECTION || listExternalIds().includes(connection),
    404,
    `Unknown connection: ${connection}`,
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
  assert(await accessEditable(), 403, "Access can only change in development");
  await writeAccess(connection, access);
}

function assertExternal(connection: string): void {
  assert(
    connection !== OWN_CONNECTION,
    400,
    "The project's own database is always writable",
  );
  assert(
    listExternalIds().includes(connection),
    404,
    `Unknown connection: ${connection}`,
  );
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
    assert(canWrite === true, 409, READ_ONLY_ACCOUNT);
  }
  const moduleId = ownModuleId();
  assert(moduleId, 503, "The console does not know its module entry");
  const next = withAccess(connection, access);
  const externalConnections = Object.fromEntries(
    Object.entries(next).map(([id, settings]) => [
      id,
      settings.access === undefined ? {} : { access: settings.access },
    ]),
  );
  const written = await ConfigureModule(moduleId, {
    config: { externalConnections },
  }).catch(() => undefined);
  assert(
    written?.ok === true,
    503,
    "The project's configuration could not be written: the DMS builder runs in development",
  );
  setExternalConnections(next);
}

/**
 * Refuses a write the project does not allow on a database.
 *
 * @param db The database written to
 */
export function assertWritable(db: Database): void {
  assert(
    db.connection === OWN_CONNECTION ||
      configuredAccess(db.connection) === "read-write",
    403,
    `Access to ${db.connection} is read only`,
  );
}

/**
 * Refuses a feature an external database does not offer.
 *
 * @param db The database the request reads
 * @param feature The feature it needs
 */
export function assertSupported(db: Database, feature: ConsoleFeature): void {
  assert(
    db.connection === OWN_CONNECTION,
    409,
    `${FEATURE_NAMES[feature]} is not available on an external database`,
  );
}
