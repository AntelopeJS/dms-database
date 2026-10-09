// The example queries an empty result offers, built on the workspace's own
// tables (D-13).

interface ExampleTable {
	name: string
	fields?: Record<string, { kind?: string } | unknown>
}

// Field names that date a row, most telling first.
const DATE_FIELDS = [
	'created_at',
	'createdAt',
	'created',
	'inserted_at',
	'updated_at',
	'updatedAt',
	'date',
]

function kindOf(descriptor: unknown): string | undefined {
	const kind = (descriptor as { kind?: unknown } | null)?.kind
	return typeof kind === 'string' ? kind : undefined
}

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
			([, descriptor]) => kindOf(descriptor) === 'date',
		)?.[0] ?? null
	)
}
