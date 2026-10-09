// The schema, instance and table an encoded query starts from, read from its
// stages the way the server reads them: what the result header names and the
// data browser link opens.

export interface QueryTarget {
	schema?: string
	/** `""` for the default instance, `"*"` across every instance. */
	instance?: string
	table?: string
}

interface EncodedStage {
	stage?: unknown
	options?: { id?: unknown }
}

const CROSS_INSTANCE_ID = '__CROSS_INSTANCE__'

function stageId(stages: EncodedStage[], name: string): unknown {
	return stages.find((stage) => stage.stage === name)?.options?.id
}

export function readQueryTarget(
	encoded: Record<string, unknown> | null,
): QueryTarget {
	const stages = Array.isArray(encoded?.stages)
		? (encoded.stages as EncodedStage[])
		: []
	const schema = stageId(stages, 'schema')
	const table = stageId(stages, 'table')
	const hasInstance = stages.some((stage) => stage.stage === 'instance')
	const instance = stageId(stages, 'instance')
	return {
		schema: typeof schema === 'string' ? schema : undefined,
		table: typeof table === 'string' ? table : undefined,
		instance: !hasInstance
			? undefined
			: instance === CROSS_INSTANCE_ID || typeof instance === 'symbol'
				? '*'
				: typeof instance === 'string'
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
	/\.\s*instance\(\s*(?:(["'`])([^"'`]*)\1|(CROSS_INSTANCE))?\s*\)/g
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
	query?: Record<string, unknown> | null
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
export function rowInstance(
	target: QueryTarget,
	row: Record<string, unknown>,
): string | null {
	if (target.instance !== '*') return target.instance ?? ''
	if (!('_instance' in row)) return null
	const instance = row._instance
	if (instance === null || instance === undefined || instance === '') return ''
	return typeof instance === 'string' ? instance : null
}

// What a link into the console names as its instance: nothing or the data
// browser's default value for the default one, `*`, `all` or the browser's
// cross-instance value for every instance.
const DEFAULT_INSTANCE_PARAMS = new Set(['', '__DEFAULT__'])
const CROSS_INSTANCE_PARAMS = new Set(['*', 'all', CROSS_INSTANCE_ID])

/** The `instance(…)` argument for an instance named by a link. */
export function instanceArgument(raw: unknown): string {
	if (typeof raw !== 'string' || DEFAULT_INSTANCE_PARAMS.has(raw)) return ''
	if (CROSS_INSTANCE_PARAMS.has(raw)) return 'CROSS_INSTANCE'
	return JSON.stringify(raw)
}
