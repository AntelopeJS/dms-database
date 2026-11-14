import type { Class } from "@antelopejs/interface-core/decorators";
import { Schema } from "@antelopejs/interface-database";
import {
  getTablesForSchema,
  type Table,
} from "@antelopejs/interface-database-decorators";
import { getTablePrimaryKey } from "./introspect";

/** The connection id of the project's own database. */
export const OWN_CONNECTION = "own";

/**
 * A database the console reads and writes through one `interface-database`
 * binding: the project's own, or one named external connection.
 */
export interface Database {
  /** {@link OWN_CONNECTION}, or the id of the external connection. */
  readonly connection: string;
  /** The schemas this binding defined, by ID. */
  schemas(): ReadonlyMap<string, Schema>;
  /**
   * The decorated classes of a schema's tables. An external database's tables
   * module declares its classes on its own binding, so it has none here.
   */
  tableClasses(schemaId: string): Record<string, Class<Table>> | undefined;
  /** The field that identifies a row, when the table has one. */
  primaryKey(schemaId: string, tableName: string): string | undefined;
  /**
   * The columns a table stores, when its schema fixes them. The own database
   * is schemaless, so it answers `undefined` and takes any field.
   */
  columns(schemaId: string, tableName: string): ReadonlySet<string> | undefined;
}

/** The project's own database, the binding a plain import reaches. */
export const OWN_DATABASE: Database = {
  connection: OWN_CONNECTION,
  schemas: () => Schema.list(),
  tableClasses: getTablesForSchema,
  primaryKey: getTablePrimaryKey,
  columns: () => undefined,
};

/**
 * An external database read through a named binding. Its provider aliases
 * `_id` to the relation's key, and a relation without a key declares no `_id`.
 *
 * @param connection The connection id
 * @param schemas The binding's schema registry
 * @returns The database
 */
export function externalDatabase(
  connection: string,
  schemas: () => ReadonlyMap<string, Schema>,
): Database {
  const fieldsOf = (schemaId: string, tableName: string) => {
    const definition = schemas().get(schemaId)?.definition;
    if (!definition || !Object.hasOwn(definition, tableName)) return;
    return definition[tableName].fields;
  };
  return {
    connection,
    schemas,
    tableClasses: () => undefined,
    primaryKey: (schemaId, tableName) => {
      const fields = fieldsOf(schemaId, tableName);
      return fields && Object.hasOwn(fields, "_id") ? "_id" : undefined;
    },
    columns: (schemaId, tableName) => {
      const fields = fieldsOf(schemaId, tableName);
      return fields && new Set(Object.keys(fields));
    },
  };
}
