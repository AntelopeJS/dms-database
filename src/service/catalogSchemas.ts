import { Logging } from "@antelopejs/interface-core/logging";
import type { SchemaDefinition } from "@antelopejs/interface-database";
import type {
  ColumnDescription,
  RelationDescription,
} from "@antelopejs/interface-database-catalog";
import { TIMED_OUT, withDeadline } from "../utils/deadline";

const ID_FIELD = "_id";

type TableDefinition = SchemaDefinition[string];

/**
 * Columns a provider keeps for itself and refuses as declared fields: a
 * relation that has one still registers, without it.
 */
const UNDECLARABLE_COLUMNS = new Set(["_instance", "_extra"]);

/**
 * Marks the schemas this module defined from a catalog. Core drops a
 * module's registrations when it reloads, while the binding's `Schema.list`
 * keeps their objects, so the next generation knows them by this mark and
 * defines them again. `Symbol.for` makes the mark the same across reloads.
 */
const CATALOG_SCHEMA = Symbol.for("@antelopejs/dms-database/catalog-schema");

/** The longest a request waits for a catalog's relations, in milliseconds. */
const CATALOG_SCHEMAS_DEADLINE_MS = 5_000;

/** A schema a binding lists, as far as this module reads it. */
export interface ListedSchema {
  readonly id: string;
}

/** The `Schema` export of an external binding: its registry, and the constructor that defines one. */
export interface SchemaRegistry<S extends ListedSchema = ListedSchema> {
  list(): ReadonlyMap<string, S>;
  new (id: string, definition: SchemaDefinition): S;
}

/** The catalog functions the console defines schemas from. */
export interface RelationCatalog {
  ListRelations(): Promise<{ schema: string; name: string }[]>;
  DescribeRelations(relations: string[]): Promise<RelationDescription[]>;
}

function declaredField(column: ColumnDescription): string | undefined {
  if (column.name === ID_FIELD || UNDECLARABLE_COLUMNS.has(column.name))
    return undefined;
  return column.accepts[0]?.declared;
}

/**
 * A relation's table as a generated tables module declares it: `_id` when
 * the relation has a key, then each column as the first declaration the
 * catalog says registration accepts. A column no field type reads is left
 * out.
 */
function tableDefinition(relation: RelationDescription): TableDefinition {
  const fields: Record<string, string> = relation.key
    ? { [ID_FIELD]: "string" }
    : {};
  for (const column of relation.columns) {
    const declared = declaredField(column);
    if (declared !== undefined) fields[column.name] = declared;
  }
  return { fields, indexes: {} };
}

/**
 * The schemas a catalog's relations define, by native schema, leaving out
 * the relations the provider cannot register and the schemas `taken` names.
 *
 * @param relations The relations, as the catalog describes them
 * @param taken The schemas another module defines on the binding
 * @returns The definitions, by schema id
 */
export function catalogDefinitions(
  relations: readonly RelationDescription[],
  taken: ReadonlySet<string>,
): Map<string, SchemaDefinition> {
  const definitions = new Map<string, SchemaDefinition>();
  for (const relation of relations) {
    if (relation.unmappable !== undefined || taken.has(relation.schema))
      continue;
    const definition = definitions.get(relation.schema) ?? {};
    definition[relation.name] = tableDefinition(relation);
    definitions.set(relation.schema, definition);
  }
  return definitions;
}

/** Whether this module defined the schema from a catalog, in this generation or an earlier one. */
export function isCatalogSchema(schema: ListedSchema): boolean {
  return Object.hasOwn(schema, CATALOG_SCHEMA);
}

/** The schemas defined on the binding by another module, which keep their own definition. */
function moduleSchemas(registry: SchemaRegistry): Set<string> {
  return new Set(
    [...registry.list()]
      .filter(([, schema]) => !isCatalogSchema(schema))
      .map(([id]) => id),
  );
}

async function describeAll(
  catalog: RelationCatalog,
): Promise<RelationDescription[]> {
  const listed = await catalog.ListRelations();
  if (listed.length === 0) return [];
  return catalog.DescribeRelations(
    listed.map(({ schema, name }) => `${schema}.${name}`),
  );
}

/** What defining a connection's catalog schemas came to: done, or worth another try. */
type Outcome = "settled" | "retry";

/**
 * Defines, on an external binding, a schema per native schema its catalog
 * lists and no module defines, so the console browses a database the moment
 * it is connected, before any tables module declares its tables. A schema a
 * module defines keeps its definition: the console never replaces it.
 *
 * @param connection The connection id, for the server's log
 * @param registry The binding's `Schema` export
 * @param catalog The connection's catalog
 * @param define Runs a definition as this module, which then owns it
 * @returns `"retry"` when the catalog did not answer in time
 */
export async function defineCatalogSchemas(
  connection: string,
  registry: SchemaRegistry,
  catalog: RelationCatalog,
  define: (work: () => void) => void,
): Promise<Outcome> {
  const described = await withDeadline(
    describeAll(catalog).catch((error: unknown) => {
      Logging.Warn(
        `[dms-database] the catalog of ${connection} lists no relation to browse`,
        error,
      );
      return [];
    }),
    CATALOG_SCHEMAS_DEADLINE_MS,
  );
  if (described === TIMED_OUT) return "retry";
  const definitions = catalogDefinitions(described, moduleSchemas(registry));
  define(() => {
    for (const [id, definition] of definitions) {
      const schema = new registry(id, definition);
      Reflect.defineProperty(schema, CATALOG_SCHEMA, { value: true });
    }
  });
  return "settled";
}

const settled = new Map<string, Promise<Outcome>>();

/**
 * {@link defineCatalogSchemas} once per connection and module generation;
 * again on the next request when the catalog did not answer in time.
 */
export async function ensureCatalogSchemas(
  connection: string,
  define: () => Promise<Outcome>,
): Promise<void> {
  const pending = settled.get(connection) ?? define();
  settled.set(connection, pending);
  const outcome = await pending.catch((error: unknown) => {
    settled.delete(connection);
    throw error;
  });
  if (outcome === "retry") settled.delete(connection);
}
