import {
	Datum,
	Query,
	Schema,
	SchemaInstance,
	Selection,
	SingleSelection,
	Stream,
	Table,
	ValueProxy,
} from '@antelopejs/interface-database/staged-query'

export interface QueryStage {
	stage: string
	options?: unknown
	args: unknown[]
}

type StagedCtor = new (...args: never[]) => unknown

const STAGED_CLASSES: Record<string, StagedCtor> = {
	Schema,
	SchemaInstance,
	Table,
	Selection,
	SingleSelection,
	Stream,
	Datum,
	Query,
	ValueProxy,
}

function classNameOf(obj: object): string | undefined {
	for (const [name, ctor] of Object.entries(STAGED_CLASSES)) {
		if (obj instanceof ctor) return name
	}
	return undefined
}

export function encodeStaged(node: unknown): unknown {
	if (node === null || node === undefined) return node
	if (typeof node !== 'object') return node
	if (Array.isArray(node)) return node.map(encodeStaged)

	const cls = classNameOf(node)
	if (cls) {
		const stages = (node as { stages?: unknown[] }).stages ?? []
		return {
			__cls: cls,
			stages: stages.map(encodeStage),
		}
	}

	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
		out[key] = encodeStaged(value)
	}
	return out
}

function encodeStage(stage: unknown): unknown {
	if (!stage || typeof stage !== 'object') return stage
	const { stage: name, options, args } = stage as Partial<QueryStage>
	const encoded: QueryStage = {
		stage: typeof name === 'string' ? name : '',
		args: Array.isArray(args) ? args.map(encodeStaged) : [],
	}
	if (options !== undefined) encoded.options = encodeStaged(options)
	return encoded
}

const MUTATING_STAGES = new Set(['insert', 'update', 'replace', 'delete'])

export function containsMutations(root: unknown): boolean {
	if (!root || typeof root !== 'object') return false
	const stages = (root as { stages?: unknown }).stages
	if (!Array.isArray(stages)) return false
	for (const stage of stages) {
		if (!stage || typeof stage !== 'object') continue
		const s = stage as { stage?: unknown; args?: unknown }
		if (typeof s.stage === 'string' && MUTATING_STAGES.has(s.stage)) {
			return true
		}
		if (Array.isArray(s.args)) {
			for (const arg of s.args) {
				if (containsMutations(arg)) return true
			}
		}
	}
	return false
}
