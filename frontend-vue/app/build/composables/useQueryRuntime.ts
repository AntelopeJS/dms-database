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
import { isObjectLike } from './guards'
import type { SchemaSummary } from './useDatabaseSchemas'

/**
 * A staged query as the server takes it: a plain object whose `stages` list
 * what to run, tagged with the class of the staged object it came from.
 */
export type StagedQuery = {
	__cls?: string
	stages?: unknown[]
}

interface PreparedQuery {
	query: StagedQuery
	source: string
	hasMutations: boolean
}

type SchemaBindings = Record<string, Schema<unknown, unknown>>

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

function buildSchemasMap(summaries: SchemaSummary[]) {
	return Object.fromEntries(
		summaries.map((summary) => [
			summary.id,
			Schema.get(summary.id) ??
				new Schema(summary.id, toSchemaDefinition(summary)),
		]),
	)
}

/** Keys read off the schema map by the engine rather than by the query. */
const IGNORED_KEYS = new Set(['then', 'toJSON'])

/** Whether a property key is a string one, as a schema id is. */
function isStringKey(key: string | symbol): key is string {
	return typeof key === 'string'
}

/** The schema map, naming an unknown schema instead of answering undefined. */
function guardSchemas(bindings: SchemaBindings) {
	return new Proxy(bindings, {
		get(target, key) {
			if (!isStringKey(key)) return undefined
			if (Object.hasOwn(target, key)) return target[key]
			if (IGNORED_KEYS.has(key)) return undefined
			throw new QueryInputError(`Unknown schema "${key}"`, {
				kind: 'unknown_schema',
				schema: key,
			})
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

function compile(code: string, text: string) {
	const wrapped = `"use strict"; return (${code}\n);`
	try {
		// oxlint-disable-next-line typescript/no-implied-eval -- the browser query console compiles the signed-in admin's own query text, in their own browser session
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
		)
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error
		const place = findSyntaxPlace(text)
		const where = place ? ` at line ${place.line}, column ${place.column}` : ''
		throw new QueryInputError(`Syntax error${where}: ${error.message}`, {
			kind: 'syntax',
			place,
			detail: error.message,
		})
	}
}

/** Whether a value lists the stages of a staged query. */
function hasStageList(value: unknown): value is { stages: unknown[] } {
	return isObjectLike(value) && 'stages' in value && Array.isArray(value.stages)
}

/** Whether a value is a staged query: a plain object, with its stages when it has any. */
function isStagedQuery(value: unknown): value is StagedQuery {
	return (
		isObjectLike(value) &&
		!Array.isArray(value) &&
		(!('__cls' in value) || typeof value.__cls === 'string') &&
		(!('stages' in value) || Array.isArray(value.stages))
	)
}

/**
 * Runs the query text and returns the staged object it evaluates to. `text`
 * is the editor's, so a syntax problem points at its line and column.
 */
function evaluateUserCode(
	code: string,
	text: string,
	schemas: SchemaBindings,
): { stages: unknown[] } {
	const result: unknown = compile(code, text)(
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
	if (!isObjectLike(result)) {
		throw new TypeError(
			'Query must evaluate to a staged object (e.g. schemas.<id>.instance().table("...").slice(0, 10))',
		)
	}
	if (!hasStageList(result)) {
		throw new TypeError(
			'Query result is not a staged object — check that the chain ends on a Table/Selection/Stream/Datum/Query.',
		)
	}
	return result
}

/** A closing semicolon ends a statement, which the wrapped expression is not. */
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

	const encoded = encodeStaged(result)
	if (!isStagedQuery(encoded)) {
		throw new TypeError('Failed to encode query')
	}

	return {
		query: encoded,
		source: trimmed,
		hasMutations: containsMutations(result),
	}
}
