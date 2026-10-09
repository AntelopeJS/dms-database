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

export type DatabasePage = keyof typeof DATABASE_PAGES

/** A column value the data browser filters the table on when it opens. */
export interface TableMatch {
	field: string
	value: string
}

export interface TableAddress {
	schema: string
	table: string
	instance?: string
	match?: TableMatch
}

const MATCH_SEPARATOR = ':'

/** The URL's `instance` for every instance at once (the data browser's "all"). */
export const ALL_INSTANCES_PARAM = 'all'
// Prefixed to a named instance that would read as "all", or as escaped.
const INSTANCE_ESCAPE = '~'

/**
 * A named instance as the URL's `instance` carries it: an instance really
 * named "all" is written "~all", and one starting with "~" gets one more.
 */
export function encodeNamedInstance(id: string): string {
	return id === ALL_INSTANCES_PARAM || id.startsWith(INSTANCE_ESCAPE)
		? `${INSTANCE_ESCAPE}${id}`
		: id
}

/** The named instance an `instance` parameter other than "all" stands for. */
export function decodeNamedInstance(param: string): string {
	return param.startsWith(INSTANCE_ESCAPE) ? param.slice(1) : param
}

export function encodeMatch(match: TableMatch): string {
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
	if (address.instance)
		query.set('instance', encodeNamedInstance(address.instance))
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
