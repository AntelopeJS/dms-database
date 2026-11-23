import type { FieldDescriptor } from '../composables/useDatabaseSchemas'

interface ExampleTable {
	name: string
	fields?: Record<string, FieldDescriptor>
}

/** Field names that date a row, most telling first. */
const DATE_FIELDS = [
	'created_at',
	'createdAt',
	'created',
	'inserted_at',
	'updated_at',
	'updatedAt',
	'date',
]

/**
 * The field that orders a table's rows by age, for "Latest rows": a known
 * creation-date name, else the first date field; null when none dates them.
 */
export function latestOrderField(table: ExampleTable): string | null {
	const fields = table.fields ?? {}
	const named = DATE_FIELDS.find((name) => Object.hasOwn(fields, name))
	if (named) return named
	return (
		Object.entries(fields).find(
			([, descriptor]) => descriptor.kind === 'date',
		)?.[0] ?? null
	)
}
