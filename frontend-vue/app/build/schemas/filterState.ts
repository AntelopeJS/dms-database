import type { InstanceChoice } from '../data/instanceOptions'

// The Schemas page's filter bar keeps its state in the URL, so a filtered
// list can be shared, reloaded and gone back to: `scope` (a schema),
// `instance`, `q` (a table or column name) and `has` (relations, modifiers,
// empty). `schema` and `table` are the inspector's. The table view reads the
// same keys as hidden filters and sends them to its source route, which
// reads them back (src/service/schemaFilters.ts holds the same rules).

export const FILTER_KEYS = ['scope', 'instance', 'q', 'has'] as const
export type FilterKey = (typeof FILTER_KEYS)[number]

export const HAS_FLAGS = ['relations', 'modifiers', 'empty'] as const
export type HasFlag = (typeof HAS_FLAGS)[number]
const HAS_SEPARATOR = ','

/** The URL's `instance` for the default instance; no value means all. */
export const DEFAULT_INSTANCE_PARAM = 'default'
// Prefixed to a named instance that would read as the default one, or as
// escaped: an instance really named "default" is written "~default".
const INSTANCE_ESCAPE = '~'

export type { InstanceChoice }

export interface SchemasFilterState {
	/** The schema listed; null for every schema. */
	scope: string | null
	instance: InstanceChoice
	/** A part of a table or column name, trimmed; empty for none. */
	q: string
	/** Structure the tables must have, all of them, in a fixed order. */
	has: HasFlag[]
}

export const EMPTY_FILTER_STATE: SchemasFilterState = {
	scope: null,
	instance: { kind: 'all' },
	q: '',
	has: [],
}

type Query = Record<string, unknown>

function text(value: unknown): string {
	const first = Array.isArray(value) ? value[0] : value
	return typeof first === 'string' ? first.trim() : ''
}

export function encodeInstance(choice: InstanceChoice): string | undefined {
	if (choice.kind === 'all') return undefined
	if (choice.kind === 'default') return DEFAULT_INSTANCE_PARAM
	return choice.id === DEFAULT_INSTANCE_PARAM ||
		choice.id.startsWith(INSTANCE_ESCAPE)
		? `${INSTANCE_ESCAPE}${choice.id}`
		: choice.id
}

export function decodeInstance(param: string | undefined): InstanceChoice {
	if (!param) return { kind: 'all' }
	if (param === DEFAULT_INSTANCE_PARAM) return { kind: 'default' }
	return {
		kind: 'named',
		id: param.startsWith(INSTANCE_ESCAPE) ? param.slice(1) : param,
	}
}

/** Known flags only, once each, in their fixed order. */
export function parseHas(param: string | undefined): HasFlag[] {
	if (!param) return []
	const asked = new Set(param.split(HAS_SEPARATOR).map((flag) => flag.trim()))
	return HAS_FLAGS.filter((flag) => asked.has(flag))
}

/** The bar's state from a route query; an empty value reads as unset. */
export function readFilterState(query: Query): SchemasFilterState {
	return {
		scope: text(query.scope) || null,
		instance: decodeInstance(text(query.instance)),
		q: text(query.q),
		has: parseHas(text(query.has)),
	}
}

/** The URL values of a state; undefined for what is unset. */
export function filterParams(
	state: SchemasFilterState,
): Record<FilterKey, string | undefined> {
	const has = parseHas(state.has.join(HAS_SEPARATOR))
	return {
		scope: state.scope || undefined,
		instance: encodeInstance(state.instance),
		q: state.q.trim() || undefined,
		has: has.length > 0 ? has.join(HAS_SEPARATOR) : undefined,
	}
}

/**
 * A route query carrying this state, the rest of it kept: an unset key is
 * dropped, empty ones included (the Inspect URL writes every key).
 */
export function withFilterState(
	query: Query,
	state: SchemasFilterState,
): Query {
	const next: Query = { ...query }
	for (const [key, value] of Object.entries(filterParams(state))) {
		if (value === undefined) delete next[key]
		else next[key] = value
	}
	return next
}

/** Whether the bar narrows the list at all. */
export function isFiltered(state: SchemasFilterState): boolean {
	return Object.values(filterParams(state)).some((value) => value !== undefined)
}

/** The source route's query for a state, as the table view sends it. */
export function sourceQuery(state: SchemasFilterState): Record<string, string> {
	const query: Record<string, string> = {}
	for (const [key, value] of Object.entries(filterParams(state))) {
		if (value !== undefined) query[`filter_${key}`] = `is:${value}`
	}
	return query
}

/** Another schema: a named instance belongs to the one left. */
export function withScope(
	state: SchemasFilterState,
	scope: string | null,
): SchemasFilterState {
	const keepsInstance =
		state.instance.kind !== 'named' || (scope !== null && scope === state.scope)
	return {
		...state,
		scope,
		instance: keepsInstance ? state.instance : { kind: 'all' },
	}
}

export function toggleHas(
	state: SchemasFilterState,
	flag: HasFlag,
): SchemasFilterState {
	const has = state.has.includes(flag)
		? state.has.filter((entry) => entry !== flag)
		: [...state.has, flag]
	return { ...state, has: HAS_FLAGS.filter((entry) => has.includes(entry)) }
}

export function sameInstance(left: InstanceChoice, right: InstanceChoice) {
	return encodeInstance(left) === encodeInstance(right)
}
