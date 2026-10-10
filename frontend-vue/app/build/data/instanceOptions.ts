// The names a picker lists for a search: schema ids, or the named instances
// of a schema. A SaaS schema can hold one instance per tenant, so a picker
// renders at most `limit` of them and says how many matched.

export const PICKER_LIMIT = 100

/** Every instance, the default one, or a named one. */
export type InstanceChoice =
	| { kind: 'all' }
	| { kind: 'default' }
	| { kind: 'named'; id: string }

const collator = new Intl.Collator(undefined, { numeric: true })

/** Names in order, numbers by value, once each. */
export function sortNames(names: readonly string[]): string[] {
	return [...new Set(names)].sort(collator.compare)
}

interface NameMatches {
	shown: string[]
	total: number
}

/** Expects names already sorted; matches a name containing the search. */
export function matchNames(
	sorted: readonly string[],
	search: string,
	limit = PICKER_LIMIT,
): NameMatches {
	const needle = search.trim().toLowerCase()
	const matches = needle
		? sorted.filter((id) => id.toLowerCase().includes(needle))
		: sorted
	return { shown: matches.slice(0, limit), total: matches.length }
}
