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
