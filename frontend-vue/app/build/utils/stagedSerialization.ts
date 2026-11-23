import {
	CROSS_INSTANCE,
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
import { type CellValue, isBigInt, isRecord, isScalar, isText } from './values'

type EncodedStage = {
	stage: string
	options?: CellValue
	args: CellValue[]
}

/** A node of a staged query that holds its stages. */
interface StagedInstance {
	stages?: unknown
}

type StagedCtor = new (...args: never[]) => object

const STAGED_CLASSES = new Map<string, StagedCtor>([
	['Schema', Schema],
	['SchemaInstance', SchemaInstance],
	['Table', Table],
	['Selection', Selection],
	['SingleSelection', SingleSelection],
	['Stream', Stream],
	['Datum', Datum],
	['Query', Query],
	['ValueProxy', ValueProxy],
])

function classNameOf(node: StagedInstance): string | undefined {
	for (const [name, ctor] of STAGED_CLASSES) {
		if (node instanceof ctor) return name
	}
	return undefined
}

function isCrossInstance(value: unknown): value is typeof CROSS_INSTANCE {
	return value === CROSS_INSTANCE
}

/** The symbol CROSS_INSTANCE, which JSON drops, travels as this sentinel, which the server turns back into the symbol. */
export const CROSS_INSTANCE_SENTINEL = '__CROSS_INSTANCE__'

function encodeStage(stage: unknown): CellValue {
	if (isRecord(stage)) {
		const { stage: name, options, args } = stage
		const encoded: EncodedStage = {
			stage: isText(name) ? name : '',
			args: Array.isArray(args) ? args.map(encodeStaged) : [],
		}
		if (options !== undefined) encoded.options = encodeStaged(options)
		return encoded
	}
	if (isScalar(stage)) return stage
	return undefined
}

/** A staged query as JSON: its classes by name with their stages, anything else as the plain data it holds. */
export function encodeStaged(node: unknown): CellValue {
	if (isCrossInstance(node)) return CROSS_INSTANCE_SENTINEL
	if (isBigInt(node))
		throw new TypeError('Do not know how to serialize a BigInt')
	if (isScalar(node)) return node
	if (Array.isArray(node)) return node.map(encodeStaged)
	if (isRecord(node)) {
		const cls = classNameOf(node)
		if (cls) {
			const stages: unknown = node.stages
			return {
				__cls: cls,
				stages: Array.isArray(stages) ? stages.map(encodeStage) : [],
			}
		}
		const out: { [key: string]: CellValue } = {}
		for (const [key, value] of Object.entries(node)) {
			out[key] = encodeStaged(value)
		}
		return out
	}
	return undefined
}

const MUTATING_STAGES = new Set(['insert', 'update', 'replace', 'delete'])

function isMutatingStage(stage: unknown): boolean {
	if (isRecord(stage)) {
		const { stage: name, args } = stage
		if (isText(name) && MUTATING_STAGES.has(name)) return true
		return Array.isArray(args) && args.some(containsMutations)
	}
	return false
}

/** Whether a staged query writes: one of its stages, or of the queries it takes, inserts, updates, replaces or deletes. */
export function containsMutations(root: unknown): boolean {
	if (isRecord(root)) {
		const stages = root.stages
		return Array.isArray(stages) && stages.some(isMutatingStage)
	}
	return false
}
