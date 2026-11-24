import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import {
  EncryptionModifier,
  getMetadata,
  HashModifier,
  ModifiersStaticMetadata,
} from "@antelopejs/interface-database-decorators";
import type { JsonObject } from "../types/json";
import { isJsonObjectValue } from "../types/json";
import { isObject } from "../utils/guards";
import { answerInTime, type BrowseSelection, resolveTable } from "./browse";
import { listExternalIds, resolveDatabase } from "./connections";
import { type Database, OWN_CONNECTION } from "./database";
import { hasInstances } from "./introspect";
import { untaggedRow } from "./jsonRows";
import { describeUnknownQueryTarget } from "./queryInspection";

/** A table a node reads, as its ports name it. */
export interface RowTarget {
  schema: string;
  /** `""` for the default instance. */
  instance: string;
  table: string;
  allInstances?: boolean;
}

/**
 * The database a connection id names: `own` or a listed external connection.
 *
 * @param connection The connection id
 * @returns The database
 * @throws Error for a connection the project does not list
 */
export async function resolveConnection(connection: string): Promise<Database> {
  if (
    connection !== OWN_CONNECTION &&
    !listExternalIds().includes(connection)
  ) {
    throw new Error(`Unknown connection "${connection}"`);
  }
  return resolveDatabase(connection);
}

/**
 * The selection a node's ports name. A named instance must be one the schema
 * lists; an external database has no instances, so it refuses a named
 * instance and every instance.
 *
 * @param db The database read
 * @param target The schema, instance and table
 * @returns The selection
 * @throws Error for an instance the database cannot read
 */
export async function selectionOf(
  db: Database,
  target: RowTarget,
): Promise<BrowseSelection> {
  const base = { schema: target.schema, table: target.table };
  if (target.allInstances) {
    if (target.instance) {
      throw new Error("Name an instance or every instance, not both");
    }
    if (!hasInstances(db)) {
      throw new Error(
        `${db.connection} has no instances: count its tables without every instance`,
      );
    }
    return { ...base, instance: CROSS_INSTANCE };
  }
  if (!target.instance) return { ...base, instance: undefined };
  if (target.instance === "*") {
    throw new Error(
      'The instance "*" is not an instance name: read every instance with allInstances',
    );
  }
  if (!hasInstances(db)) {
    throw new Error(
      `${db.connection} has no instances: read its tables without one`,
    );
  }
  const unknown = await describeUnknownQueryTarget(target);
  if (unknown) throw new Error(unknown);
  return { ...base, instance: target.instance };
}

/**
 * The fields of a table whose stored value is a hash or a ciphertext. An
 * external database's tables declare no modifiers.
 */
function lockedFields(db: Database, schema: string, table: string): string[] {
  const TableClass = db.tableClasses(schema)?.[table];
  if (!TableClass) return [];
  const meta = getMetadata(TableClass, ModifiersStaticMetadata, true);
  return Object.entries(meta.fields ?? {}).flatMap(([field, modifiers]) =>
    modifiers.some(
      ({ modifier }) =>
        modifier instanceof HashModifier ||
        modifier instanceof EncryptionModifier,
    )
      ? [field]
      : [],
  );
}

function withoutKeys(object: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(
    Object.entries(object).filter(([key]) => !keys.includes(key)),
  );
}

/**
 * A stored row without its hashed and encrypted fields: the field itself and
 * the locked value the decorators keep under `_internal.data`.
 */
function withoutLockedFields(
  row: JsonObject,
  fields: readonly string[],
): JsonObject {
  if (fields.length === 0) return row;
  const visible = withoutKeys(row, fields);
  const internal = row._internal;
  if (internal === undefined || !isJsonObjectValue(internal)) return visible;
  const data = internal.data;
  if (data === undefined || !isJsonObjectValue(data)) return visible;
  return {
    ...visible,
    _internal: { ...internal, data: withoutKeys(data, fields) },
  };
}

/** What `getRow` reads. */
export interface RowAnswer {
  found: boolean;
  row: JsonObject | null;
  primaryKey: string | null;
}

/**
 * One row by its primary key, as JSON without its instance tag and without
 * its hashed and encrypted fields. An external database that does not answer
 * in time is refused with a 504.
 *
 * @param db The database read
 * @param selection The table
 * @param id The primary key value
 * @returns The row, or `found: false`
 */
export async function getRow(
  db: Database,
  selection: BrowseSelection,
  id: string,
): Promise<RowAnswer> {
  const read = resolveTable(db, selection).get(id).run();
  const stored: unknown = hasInstances(db)
    ? await read
    : await answerInTime(read);
  const primaryKey = db.primaryKey(selection.schema, selection.table) ?? null;
  const { row } = untaggedRow(isObject(stored) ? stored : null);
  if (!row) return { found: false, row: null, primaryKey };
  return {
    found: true,
    row: withoutLockedFields(
      row,
      lockedFields(db, selection.schema, selection.table),
    ),
    primaryKey,
  };
}
