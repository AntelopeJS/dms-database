import {
	matchInstances,
	sortInstances,
	type InstanceMatches,
} from './instanceOptions'

// The schemas a schema picker lists for a search (the Schemas page's filter
// bar): sorted by name, at most `limit` rendered with how many matched, and
// the few last picked kept at hand.

export const SCHEMA_PICKER_LIMIT = 100
export const RECENT_SCHEMAS_LIMIT = 3

/** Schema ids by name, numbers in order, once each. */
export const sortSchemaIds = sortInstances

/** Expects ids already sorted; matches an id containing the search. */
export function matchSchemas(
	sorted: readonly string[],
	search: string,
	limit = SCHEMA_PICKER_LIMIT,
): InstanceMatches {
	return matchInstances(sorted, search, limit)
}

/** The schemas last picked, this one first. */
export function rememberSchema(
	recent: readonly string[],
	id: string,
	limit = RECENT_SCHEMAS_LIMIT,
): string[] {
	return [id, ...recent.filter((entry) => entry !== id)].slice(0, limit)
}

/** The recent schemas still registered, from what storage held. */
export function recentSchemas(
	stored: unknown,
	known: ReadonlySet<string>,
	limit = RECENT_SCHEMAS_LIMIT,
): string[] {
	if (!Array.isArray(stored)) return []
	const ids = stored.filter(
		(id): id is string => typeof id === 'string' && known.has(id),
	)
	return [...new Set(ids)].slice(0, limit)
}
