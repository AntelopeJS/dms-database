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
import { javascriptLanguage } from '@codemirror/lang-javascript'
import { containsMutations, encodeStaged } from '../utils/stagedSerialization'
import type { SchemaSummary } from './useDatabaseSchemas'

interface PreparedQuery {
	query: Record<string, unknown>
	source: string
	hasMutations: boolean
}

interface SchemaDefLike {
	[tableName: string]: { fields: unknown; indexes: unknown }
}

/** Where a query text breaks (1-based line and column). */
export interface SyntaxPlace {
	line: number
	column: number
}

export type QueryInputProblem =
	| { kind: 'syntax'; place: SyntaxPlace | null; detail: string }
	| { kind: 'unknown_schema'; schema: string }

/**
 * A query the console could not send, for a reason it can name: a syntax
 * error with its place, or a schema the workspace does not have. The message
 * is English; the console words it from `problem`.
 */
export class QueryInputError extends Error {
	readonly problem: QueryInputProblem

	constructor(message: string, problem: QueryInputProblem) {
		super(message)
		this.name = 'QueryInputError'
		this.problem = problem
	}
}

function toSchemaDefinition(summary: SchemaSummary): SchemaDefLike {
	const def: SchemaDefLike = {}
	for (const table of summary.tables) {
		def[table.name] = {
			fields: table.fields ?? {},
			indexes: table.indexes ?? {},
		}
	}
	return def
}

function buildSchemasMap(
	summaries: SchemaSummary[],
): Record<string, Schema<unknown, SchemaDefLike>> {
	const bindings: Record<string, Schema<unknown, SchemaDefLike>> = {}
	for (const summary of summaries) {
		bindings[summary.id] =
			Schema.get<unknown, SchemaDefLike>(summary.id) ??
			new Schema(summary.id, toSchemaDefinition(summary))
	}
	return bindings
}

// Keys read off the schema map by the engine rather than by the query.
const IGNORED_KEYS = new Set(['then', 'toJSON'])

/** The schema map, naming an unknown schema instead of answering undefined. */
function guardSchemas<T extends object>(
	bindings: Record<string, T>,
): Record<string, T> {
	return new Proxy(bindings, {
		get(target, key, receiver) {
			if (
				typeof key === 'string' &&
				!(key in target) &&
				!IGNORED_KEYS.has(key)
			) {
				throw new QueryInputError(`Unknown schema "${key}"`, {
					kind: 'unknown_schema',
					schema: key,
				})
			}
			return Reflect.get(target, key, receiver)
		},
	})
}

/**
 * Where the JavaScript parser of the editor stops on a query text: the first
 * error node of its tree; null when it parses.
 */
export function findSyntaxPlace(text: string): SyntaxPlace | null {
	let at: number | null = null
	javascriptLanguage.parser.parse(text).iterate({
		enter(node) {
			if (at !== null) return false
			if (!node.type.isError) return undefined
			at = node.from
			return false
		},
	})
	if (at === null) return null
	const before = text.slice(0, at)
	return {
		line: before.split('\n').length,
		column: at - before.lastIndexOf('\n'),
	}
}

type QueryFunction = (...args: unknown[]) => unknown

function compile(code: string, text: string): QueryFunction {
	const wrapped = `"use strict"; return (${code}\n);`
	try {
		return new Function(
			'schemas',
			'Schema',
			'SchemaInstance',
			'Table',
			'Selection',
			'SingleSelection',
			'Stream',
			'Datum',
			'Query',
			'ValueProxy',
			'CROSS_INSTANCE',
			wrapped,
		) as QueryFunction
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error
		// The engine's message points at the wrapper; the editor's parser tells
		// where the text itself breaks.
		const place = findSyntaxPlace(text)
		const where = place ? ` at line ${place.line}, column ${place.column}` : ''
		throw new QueryInputError(`Syntax error${where}: ${error.message}`, {
			kind: 'syntax',
			place,
			detail: error.message,
		})
	}
}

// `text` is the editor's, so a syntax problem points at its line and column.
function evaluateUserCode(
	code: string,
	text: string,
	schemas: Record<string, Schema<unknown, SchemaDefLike>>,
): unknown {
	return compile(code, text)(
		guardSchemas(schemas),
		Schema,
		SchemaInstance,
		Table,
		Selection,
		SingleSelection,
		Stream,
		Datum,
		Query,
		ValueProxy,
		CROSS_INSTANCE,
	)
}

// A closing semicolon ends a statement, which the wrapped expression is not.
const TRAILING_SEMICOLONS = /[;\s]+$/

export function prepareQueryPayload(
	editorText: string,
	summaries: SchemaSummary[],
): PreparedQuery {
	const trimmed = editorText.trim()
	if (!trimmed) {
		throw new Error('Query is empty')
	}

	const schemas = buildSchemasMap(summaries)
	const result = evaluateUserCode(
		trimmed.replace(TRAILING_SEMICOLONS, ''),
		editorText,
		schemas,
	)

	if (!result || typeof result !== 'object') {
		throw new TypeError(
			'Query must evaluate to a staged object (e.g. schemas.<id>.instance().table("...").slice(0, 10))',
		)
	}

	const stages = (result as { stages?: unknown }).stages
	if (!Array.isArray(stages)) {
		throw new TypeError(
			'Query result is not a staged object — check that the chain ends on a Table/Selection/Stream/Datum/Query.',
		)
	}

	const encoded = encodeStaged(result)
	if (!encoded || typeof encoded !== 'object' || Array.isArray(encoded)) {
		throw new TypeError('Failed to encode query')
	}

	return {
		query: encoded as Record<string, unknown>,
		source: trimmed,
		hasMutations: containsMutations(result),
	}
}
