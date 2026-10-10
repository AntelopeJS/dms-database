import type { InstanceChoice } from '../data/instanceOptions'

export type { InstanceChoice }

// Where the module's pages live. Module pages resolve under
// /modules/<module id>; a link without that prefix 404s.
const MODULE_ROOT = '/modules/database'

export const DATABASE_PAGES = {
	overview: `${MODULE_ROOT}/overview`,
	schemas: `${MODULE_ROOT}/schemas`,
	diagram: `${MODULE_ROOT}/diagram`,
	data: `${MODULE_ROOT}/data`,
	query: `${MODULE_ROOT}/query`,
} as const

type DatabasePage = keyof typeof DATABASE_PAGES

/** A column value the data browser filters the table on when it opens. */
interface TableMatch {
	field: string
	value: string
}

interface TableAddress {
	schema: string
	table: string
	/**
	 * A named instance, none for the default one; a page link also takes
	 * ALL_INSTANCES_PARAM for every instance.
	 */
	instance?: string
	match?: TableMatch
}

const MATCH_SEPARATOR = ':'

// The URL's `instance`, the same on every page of the module: absent for the
// default instance, `all` for every instance at once, any other value for
// the instance of that name. No escaping: an instance named "all" cannot be
// linked to.

/** The URL's `instance` for every instance at once. */
export const ALL_INSTANCES_PARAM = 'all'

/** The instance an `instance` URL parameter names; a missing one is the default. */
export function instanceFromUrl(param: unknown): InstanceChoice {
	const first = Array.isArray(param) ? param[0] : param
	const value = typeof first === 'string' ? first.trim() : ''
	if (!value) return { kind: 'default' }
	if (value === ALL_INSTANCES_PARAM) return { kind: 'all' }
	return { kind: 'named', id: value }
}

/** The `instance` URL parameter of a choice; undefined (left out) for the default. */
export function instanceToUrl(choice: InstanceChoice): string | undefined {
	if (choice.kind === 'default') return undefined
	if (choice.kind === 'all') return ALL_INSTANCES_PARAM
	return choice.id
}

function encodeMatch(match: TableMatch): string {
	return `${match.field}${MATCH_SEPARATOR}${match.value}`
}

/** `field:value` back to its parts; the value may hold separators itself. */
export function decodeMatch(raw: unknown): TableMatch | null {
	if (typeof raw !== 'string') return null
	const index = raw.indexOf(MATCH_SEPARATOR)
	if (index <= 0) return null
	return { field: raw.slice(0, index), value: raw.slice(index + 1) }
}

/** A page of the module opened on one table, e.g. the data browser on it. */
export function tableLink(page: DatabasePage, address: TableAddress): string {
	const query = new URLSearchParams({
		schema: address.schema,
		table: address.table,
	})
	if (address.instance) query.set('instance', address.instance)
	if (address.match) query.set('match', encodeMatch(address.match))
	return `${DATABASE_PAGES[page]}?${query.toString()}`
}

const IDENTIFIER = /^[A-Z_$][\w$]*$/i

/** `schemas.shop` or `schemas["dms-core"]`, as the query DSL reaches a schema. */
export function schemaAccess(schemaId: string): string {
	return IDENTIFIER.test(schemaId)
		? `schemas.${schemaId}`
		: `schemas[${JSON.stringify(schemaId)}]`
}

/** The DSL reaching a table, for the query console's prefilled snippets. */
export function tableAccess(address: TableAddress): string {
	const instance = address.instance ? JSON.stringify(address.instance) : ''
	return `${schemaAccess(address.schema)}.instance(${instance}).table(${JSON.stringify(address.table)})`
}
