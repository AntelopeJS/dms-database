import type { SchemaSummary } from '../composables/useDatabaseSchemas'
import type { QueryTarget } from './target'

// What the editor completes, by place in the chain (D-12): the methods a
// query step answers, and the schemas, instances, tables and fields of the
// workspace, indexed so a table's fields are its own.

// Schema also exposes createInstance/destroyInstance/listInstances, but only
// instance(id?) continues the browse chain, so it is the only one offered.
export const SCHEMA_METHODS = ['instance']
export const INSTANCE_METHODS = ['table'] // a SchemaInstance only exposes table(name)
// The steps of a Table, Selection, Stream or Datum: each is a method of the
// staged query classes, so a completion never names one that does not exist.
export const QUERY_METHODS = [
	'slice',
	'orderBy',
	'filter',
	'map',
	'pluck',
	'without',
	'get',
	'getAll',
	'between',
	'count',
	'distinct',
	'nth',
	'sum',
	'avg',
	'min',
	'max',
	'insert',
	'update',
	'replace',
	'delete',
	'do',
	'default',
	'key',
	'lookup',
	'changes',
]

export interface CompletionIndex {
	schemaIds: string[]
	tablesBySchema: Record<string, string[]>
	/** Fields keyed `schema.table`. */
	fieldsByTable: Record<string, string[]>
	/** Every field of a schema's tables, when the chain names no table yet. */
	fieldsBySchema: Record<string, string[]>
	instancesBySchema: Record<string, string[]>
	allTables: string[]
	allFields: string[]
}

export function buildCompletionIndex(
	schemas: SchemaSummary[],
): CompletionIndex {
	const index: CompletionIndex = {
		schemaIds: [],
		tablesBySchema: {},
		fieldsByTable: {},
		fieldsBySchema: {},
		instancesBySchema: {},
		allTables: [],
		allFields: [],
	}
	const allTables = new Set<string>()
	const allFields = new Set<string>()
	for (const schema of schemas) {
		index.schemaIds.push(schema.id)
		index.instancesBySchema[schema.id] = schema.instances ?? []
		const tables: string[] = []
		const schemaFields = new Set<string>()
		for (const table of schema.tables ?? []) {
			tables.push(table.name)
			allTables.add(table.name)
			const fields = Object.keys(table.fields ?? {})
			index.fieldsByTable[`${schema.id}.${table.name}`] = fields
			for (const field of fields) {
				schemaFields.add(field)
				allFields.add(field)
			}
		}
		index.tablesBySchema[schema.id] = tables
		index.fieldsBySchema[schema.id] = [...schemaFields]
	}
	index.allTables = [...allTables]
	index.allFields = [...allFields]
	return index
}

/** The fields to offer where the chain stands: its table's, else wider. */
export function fieldsAt(index: CompletionIndex, chain: QueryTarget): string[] {
	if (chain.schema && chain.table) {
		const own = index.fieldsByTable[`${chain.schema}.${chain.table}`]
		if (own) return own
	}
	if (chain.schema && index.fieldsBySchema[chain.schema])
		return index.fieldsBySchema[chain.schema] as string[]
	return index.allFields
}
