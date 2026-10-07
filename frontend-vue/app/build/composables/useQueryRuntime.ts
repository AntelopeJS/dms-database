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

function evaluateUserCode(
	code: string,
	schemas: Record<string, Schema<unknown, SchemaDefLike>>,
): unknown {
	const wrapped = `"use strict"; return (${code}\n);`
	const fn = new Function(
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
	return fn(
		schemas,
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

export function prepareQueryPayload(
	editorText: string,
	summaries: SchemaSummary[],
): PreparedQuery {
	const trimmed = editorText.trim()
	if (!trimmed) {
		throw new Error('Query is empty')
	}

	const schemas = buildSchemasMap(summaries)
	const result = evaluateUserCode(trimmed, schemas)

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
