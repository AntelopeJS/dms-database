import { assert } from "@antelopejs/interface-api-util";
import {
  GetInterfaceInstance,
  GetInterfaceInstances,
  GetResponsibleModule,
  RunWithResponsibleModule,
} from "@antelopejs/interface-core";
import type { Schema } from "@antelopejs/interface-database";
import type {
  CatalogInfo,
  RelationDescription,
  RelationSummary,
} from "@antelopejs/interface-database-catalog";
import { isFunction, isObject } from "../utils/guards";
import {
  type Database,
  externalDatabase,
  OWN_CONNECTION,
  OWN_DATABASE,
} from "./database";

const DATABASE_INTERFACE = "@antelopejs/interface-database";
const CATALOG_INTERFACE = "@antelopejs/interface-database-catalog";

/** The `interface-database` exports a named binding gives the console. */
interface DatabaseBinding {
  Schema: { list(): ReadonlyMap<string, Schema> };
}

/** The `interface-database-catalog` exports a named binding gives the console. */
export interface CatalogBinding {
  Info(): Promise<CatalogInfo>;
  ListRelations(): Promise<RelationSummary[]>;
  DescribeRelations(relations: string[]): Promise<RelationDescription[]>;
}

/**
 * Whether a loaded module is `interface-database`. Core loads the interface
 * package itself for the connection, so the registry `Schema.list` answers is
 * the package's own.
 */
function isDatabaseBinding(value: unknown): value is DatabaseBinding {
  if (!isObject(value) || !Object.hasOwn(value, "Schema")) return false;
  if (!("Schema" in value) || !isFunction(value.Schema)) return false;
  return "list" in value.Schema && isFunction(value.Schema.list);
}

/** Whether a loaded module is `interface-database-catalog`, as core loads it for the connection. */
function isCatalogBinding(value: unknown): value is CatalogBinding {
  if (!isObject(value)) return false;
  return (
    Object.hasOwn(value, "Info") &&
    "Info" in value &&
    isFunction(value.Info) &&
    Object.hasOwn(value, "ListRelations") &&
    "ListRelations" in value &&
    isFunction(value.ListRelations) &&
    Object.hasOwn(value, "DescribeRelations") &&
    "DescribeRelations" in value &&
    isFunction(value.DescribeRelations)
  );
}

let ownModule: string | undefined;

/**
 * Records the module this code runs as. Core answers a module's connections
 * in its own context only, and a request reaches a controller in the API
 * module's, so the lookups run as the module recorded at construct.
 */
export function recordOwnModule(): void {
  ownModule = GetResponsibleModule();
}

/** The id of this module's entry in the project configuration. */
export function ownModuleId(): string | undefined {
  return ownModule;
}

function asOwnModule<T>(work: () => T): T {
  return ownModule === undefined
    ? work()
    : RunWithResponsibleModule(ownModule, work);
}

/** Ids of the connections an interface has on this module's entry. */
function namedConnections(interfaceId: string): Set<string> {
  return new Set(
    asOwnModule(() => GetInterfaceInstances(interfaceId)).flatMap(({ id }) =>
      id === undefined ? [] : [id],
    ),
  );
}

/**
 * The external connections: a catalog connection with an `interface-database`
 * connection of the same id. The catalog describes the database and the
 * database binding reads and writes it, so a connection needs both.
 */
export function listExternalIds(): string[] {
  const databases = namedConnections(DATABASE_INTERFACE);
  return [...namedConnections(CATALOG_INTERFACE)].filter(
    (id) => id !== OWN_CONNECTION && databases.has(id),
  );
}

/**
 * Loads a named binding. Core maps the connection's path only for a request
 * from this module's own files, which this `require` is.
 */
function loadBinding<T>(
  interfaceId: string,
  connection: string,
  isBinding: (value: unknown) => value is T,
): T {
  assert(
    listExternalIds().includes(connection),
    404,
    `Unknown connection: ${connection}`,
  );
  const instance = asOwnModule(() =>
    GetInterfaceInstance(interfaceId, connection),
  );
  assert(instance, 404, `Unknown connection: ${connection}`);
  return asOwnModule(() => {
    const loaded: unknown = require(instance.path);
    assert(
      isBinding(loaded),
      500,
      `Connection ${connection} does not load ${interfaceId}`,
    );
    return loaded;
  });
}

/** The database a connection id names: `own`, or an external connection. */
export function resolveDatabase(connection: string): Database {
  if (connection === OWN_CONNECTION) return OWN_DATABASE;
  const binding = loadBinding(
    DATABASE_INTERFACE,
    connection,
    isDatabaseBinding,
  );
  return externalDatabase(connection, () => binding.Schema.list());
}

/** The catalog of an external connection. */
export function resolveCatalog(connection: string): CatalogBinding {
  return loadBinding(CATALOG_INTERFACE, connection, isCatalogBinding);
}
