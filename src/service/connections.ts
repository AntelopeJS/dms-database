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
import { getModuleConfig } from "../config";
import { isFunction, isObject } from "../utils/guards";
import { CONNECTION_REFUSALS } from "./connectionRefusals";
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

/** What a connection the project declares lacks before the console can browse it. */
export type MissingBinding = "database" | "catalog";

/**
 * A connection the project declares, by a catalog binding or a
 * `config.externalConnections` entry, that lacks a binding the console needs.
 */
export interface UnregisteredConnection {
  id: string;
  missing: MissingBinding[];
}

/**
 * The connections the project declares but the console cannot browse: ids a
 * catalog binding or `config.externalConnections` names that do not have both
 * bindings. Listing them tells the owner what to register instead of leaving
 * the database out of the console without a word.
 */
export function listUnregisteredConnections(): UnregisteredConnection[] {
  const databases = namedConnections(DATABASE_INTERFACE);
  const catalogs = namedConnections(CATALOG_INTERFACE);
  const declared = [
    ...catalogs,
    ...Object.keys(getModuleConfig().externalConnections ?? {}),
  ];
  return [...new Set(declared)]
    .filter((id) => id !== OWN_CONNECTION)
    .flatMap((id) => {
      const missing: MissingBinding[] = [
        ...(databases.has(id) ? [] : (["database"] as const)),
        ...(catalogs.has(id) ? [] : (["catalog"] as const)),
      ];
      return missing.length === 0 ? [] : [{ id, missing }];
    });
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
  const instance = asOwnModule(() =>
    GetInterfaceInstance(interfaceId, connection),
  );
  assert(instance, 404, CONNECTION_REFUSALS.unknownConnection);
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

function assertExternal(connection: string): void {
  assert(
    listExternalIds().includes(connection),
    404,
    CONNECTION_REFUSALS.unknownConnection,
  );
}

/** The database a connection id names: `own`, or an external connection. */
export function resolveDatabase(connection: string): Database {
  if (connection === OWN_CONNECTION) return OWN_DATABASE;
  assertExternal(connection);
  const binding = loadBinding(
    DATABASE_INTERFACE,
    connection,
    isDatabaseBinding,
  );
  return externalDatabase(connection, () => binding.Schema.list());
}

/** The catalog of an external connection. */
export function resolveCatalog(connection: string): CatalogBinding {
  assertExternal(connection);
  return loadBinding(CATALOG_INTERFACE, connection, isCatalogBinding);
}

/**
 * The catalog of a connection the project declares, browsable or not: it
 * names the engine and the database of a connection the console lists.
 */
export function resolveDeclaredCatalog(connection: string): CatalogBinding {
  return loadBinding(CATALOG_INTERFACE, connection, isCatalogBinding);
}
