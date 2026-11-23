import { type DatabaseConnection, isExternal } from './useDatabaseConnections'
import type { RelationDeclaration, SchemaSummary } from './useDatabaseSchemas'

/** The relations of each table of a schema, by table name. */
export type RelationsByTable = Record<string, RelationDeclaration[]>

const REQUEST_TIMEOUT_MS = 15_000

/**
 * A schema with the relations a catalog reports in place of its declared
 * ones; the schema as declared when there are none to apply.
 */
export function withCatalogRelations(
	schema: SchemaSummary | null,
	relations: RelationsByTable | null,
): SchemaSummary | null {
	if (!schema || !relations) return schema
	return {
		...schema,
		tables: schema.tables.map((table) => ({
			...table,
			relations: Object.hasOwn(relations, table.name)
				? relations[table.name]
				: [],
		})),
	}
}

/**
 * The foreign keys an external database's catalog reports out of the tables
 * of the schema the diagram shows, as the relations it draws: an external
 * schema declares none of its own.
 */
export function useCatalogReferences() {
	const { $authFetch } = useAuthFetch()
	const relations = shallowRef<RelationsByTable | null>(null)

	return {
		/**
		 * Reads a schema's foreign keys by table: `null` on the project's own
		 * database, and `undefined` when the catalog did not answer.
		 */
		async read(
			connection: DatabaseConnection | undefined,
			schema: string,
		): Promise<RelationsByTable | null | undefined> {
			if (!isExternal(connection)) return null
			try {
				const { tables } = await $authFetch<{ tables: RelationsByTable }>(
					`/api/database/connections/${encodeURIComponent(connection.id)}/schemas/${encodeURIComponent(schema)}/references`,
					{ timeout: REQUEST_TIMEOUT_MS },
				)
				return tables
			} catch {
				return undefined
			}
		},
		/** Shows what a read answered: no relation at all when the catalog did not answer. */
		keep(read: RelationsByTable | null | undefined) {
			relations.value = read === undefined ? {} : read
		},
		/** The schema with the kept relations in place of its declared ones. */
		apply: (schema: SchemaSummary | null) =>
			withCatalogRelations(schema, relations.value),
	}
}
