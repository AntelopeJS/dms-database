// The named instances an instance picker lists for a search. A SaaS schema
// can hold one instance per tenant, so the picker renders at most `limit` of
// them and says how many matched.

export const INSTANCE_PICKER_LIMIT = 100

/** Every instance, the default one, or a named one. */
export type InstanceChoice =
	| { kind: 'all' }
	| { kind: 'default' }
	| { kind: 'named'; id: string }

const collator = new Intl.Collator(undefined, { numeric: true })

export function sortInstances(instances: readonly string[]): string[] {
	return [...new Set(instances)].sort(collator.compare)
}

export interface InstanceMatches {
	shown: string[]
	total: number
}

/** Expects instances already sorted; matches a name containing the search. */
export function matchInstances(
	sorted: readonly string[],
	search: string,
	limit = INSTANCE_PICKER_LIMIT,
): InstanceMatches {
	const needle = search.trim().toLowerCase()
	const matches = needle
		? sorted.filter((id) => id.toLowerCase().includes(needle))
		: sorted
	return { shown: matches.slice(0, limit), total: matches.length }
}
