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
import { closestName } from '../query/runs'
import { findSyntaxProblem, type SyntaxProblem } from '../query/syntax'
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

export type QueryInputProblem =
	| { kind: 'syntax'; syntax: SyntaxProblem | null; detail: string }
	| { kind: 'unknown_schema'; schema: string; suggestion: string | null }

/**
 * A query the console could not send, for a reason it can name: a syntax
 * error with its place, or a schema the workspace does not have (with the
 * closest one). The message is English; the console words it from `problem`.
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
				const suggestion = closestName(key, Object.keys(target))
				const hint = suggestion ? `. Did you mean "${suggestion}"?` : ''
				throw new QueryInputError(`Unknown schema "${key}"${hint}`, {
					kind: 'unknown_schema',
					schema: key,
					suggestion,
				})
			}
			return Reflect.get(target, key, receiver)
		},
	})
}

function syntaxMessage(problem: SyntaxProblem | null, detail: string): string {
	if (!problem) return `Syntax error: ${detail}`
	const where = `line ${problem.line}, column ${problem.column}`
	switch (problem.kind) {
		case 'unclosed':
			return `Syntax error: "${problem.char}" at ${where} is never closed`
		case 'string':
			return `Syntax error: the string opened by ${problem.char} at ${where} is never closed`
		default:
			return `Syntax error: unexpected "${problem.char}" at ${where}`
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
		// The engine's message points at the wrapper; the text's own brackets
		// and quotes tell where it breaks.
		const syntax = findSyntaxProblem(text)
		throw new QueryInputError(syntaxMessage(syntax, error.message), {
			kind: 'syntax',
			syntax,
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
