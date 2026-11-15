import type { RelationDeclaration } from './useDatabaseSchemas'

/** The relations of each table of a schema, by table name. */
export type RelationsByTable = Record<string, RelationDeclaration[]>

const REQUEST_TIMEOUT_MS = 15_000

/**
 * Reads the foreign keys an external database's catalog reports out of the
 * tables of one of its schemas, as the relations the diagram draws: an
 * external schema declares none of its own.
 */
export function useCatalogReferences() {
	const { $authFetch } = useAuthFetch()

	return async function readReferences(
		connection: string,
		schema: string,
	): Promise<RelationsByTable> {
		const { tables } = await $authFetch<{ tables: RelationsByTable }>(
			`/api/database/connections/${encodeURIComponent(connection)}/schemas/${encodeURIComponent(schema)}/references`,
			{ timeout: REQUEST_TIMEOUT_MS },
		)
		return tables
	}
}
