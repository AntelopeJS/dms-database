import { type CellRow, isRecord, isSymbol, isText } from '../utils/values'
import { instanceFromUrl } from '../utils/databaseLinks'
import { CROSS_INSTANCE_SENTINEL } from '../utils/stagedSerialization'
import { escapeRegExp } from './runs'

/**
 * The schema, instance and table a query starts from: what the result header
 * names and the data browser link opens.
 */
export interface QueryTarget {
	schema?: string
	/** `""` for the default instance, `"*"` across every instance. */
	instance?: string
	table?: string
}

/** A URL query parameter: absent, one value or a repeated one. */
type UrlParam = string | null | (string | null)[] | undefined

interface EncodedStage {
	stage?: unknown
	options?: unknown
}

/** A query as the server encodes it: its stages in order. */
export interface EncodedQuery {
	stages?: unknown
}

function isEncodedStage(value: unknown): value is EncodedStage {
	return isRecord(value)
}

function stageId(
	stages: EncodedStage[],
	name: string,
): string | symbol | undefined {
	const options = stages.find((stage) => stage.stage === name)?.options
	if (!isRecord(options)) return undefined
	const id = options.id
	return isText(id) || isSymbol(id) ? id : undefined
}

/**
 * The target of an encoded query, read from its stages the way the server
 * reads them.
 */
export function readQueryTarget(encoded: EncodedQuery | null): QueryTarget {
	const encodedStages = encoded?.stages
	const stages = Array.isArray(encodedStages)
		? encodedStages.filter(isEncodedStage)
		: []
	const schema = stageId(stages, 'schema')
	const table = stageId(stages, 'table')
	const hasInstance = stages.some((stage) => stage.stage === 'instance')
	const instance = stageId(stages, 'instance')
	return {
		schema: isText(schema) ? schema : undefined,
		table: isText(table) ? table : undefined,
		instance: !hasInstance
			? undefined
			: instance === CROSS_INSTANCE_SENTINEL || isSymbol(instance)
				? '*'
				: isText(instance)
					? instance
					: '',
	}
}

/** `shop.orders @eu`, or as much of it as the query names. */
export function describeTarget(target: QueryTarget): string {
	if (!target.schema) return ''
	const table = target.table
		? `${target.schema}.${target.table}`
		: target.schema
	return target.instance ? `${table} @${target.instance}` : table
}

const SCHEMA_ACCESS =
	/schemas\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["'`]([\w$-]+)["'`]\s*\])/g
const INSTANCE_CALL =
	/\.\s*instance\(\s*(?:(?:(["'`])([^"'`]*)\1|(CROSS_INSTANCE))\s*)?\)/g
const TABLE_CALL = /\.\s*table\(\s*(["'`])([^"'`]+)\1\s*\)/g

function lastMatch(pattern: RegExp, text: string): RegExpExecArray | null {
	let last: RegExpExecArray | null = null
	pattern.lastIndex = 0
	for (let match = pattern.exec(text); match; match = pattern.exec(text))
		last = match
	return last
}

/**
 * The schema, instance and table the last chain of a query text names, read
 * from the text itself: for a query that never reached the server, or the
 * chain the cursor is in.
 */
export function targetFromSource(source: string): QueryTarget {
	const schema = lastMatch(SCHEMA_ACCESS, source)
	if (!schema) return {}
	const chain = source.slice(schema.index)
	const instance = lastMatch(INSTANCE_CALL, chain)
	const table = lastMatch(TABLE_CALL, chain)
	return {
		schema: schema[1] ?? schema[2],
		instance: !instance ? undefined : instance[3] ? '*' : (instance[2] ?? ''),
		table: table?.[2],
	}
}

/** Where a past run pointed: its encoded query, else its text. */
export function runTarget(run: {
	query?: EncodedQuery | null
	source: string
}): QueryTarget {
	const encoded = readQueryTarget(run.query ?? null)
	return encoded.schema ? encoded : targetFromSource(run.source)
}

/**
 * The instance a result row lives in, for its data browser link: the
 * query's, or the row's own `_instance` when the query read every instance.
 * `''` is the default instance; null when the row does not say.
 */
export function rowInstance(target: QueryTarget, row: CellRow): string | null {
	if (target.instance !== '*') return target.instance ?? ''
	if (!('_instance' in row)) return null
	const instance = row._instance
	if (instance === null || instance === undefined || instance === '') return ''
	return isText(instance) ? instance : null
}

/**
 * The `instance(…)` argument for the instance the URL's `instance` names:
 * none for the default one, CROSS_INSTANCE for every instance.
 */
export function instanceArgument(raw: UrlParam): string {
	const choice = instanceFromUrl(raw)
	if (choice.kind === 'default') return ''
	if (choice.kind === 'all') return 'CROSS_INSTANCE'
	return JSON.stringify(choice.id)
}

/**
 * The query text with the default instance of a schema, `instance()`, read
 * in a named instance instead: `instance("eu")`.
 */
export function withInstance(
	source: string,
	schema: string,
	instance: string,
): string {
	const name = escapeRegExp(schema)
	const access = new RegExp(
		`(schemas\\s*(?:\\.\\s*${name}(?![\\w$])|\\[\\s*(["'\`])${name}\\2\\s*\\])\\s*\\.\\s*instance\\()\\s*\\)`,
		'g',
	)
	return source.replace(
		access,
		(_, call: string) => `${call}${JSON.stringify(instance)})`,
	)
}
