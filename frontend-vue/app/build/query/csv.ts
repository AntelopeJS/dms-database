// A result as CSV, the columns of every row in the order they first appear.

const NEEDS_QUOTES = /[",\n\r]/

function csvCell(value: unknown): string {
	if (value === null || value === undefined) return ''
	const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
	return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function resultColumns(rows: Record<string, unknown>[]): string[] {
	const columns = new Set<string>()
	for (const row of rows) for (const key of Object.keys(row)) columns.add(key)
	return [...columns]
}

export function toCsv(rows: Record<string, unknown>[]): string {
	const columns = resultColumns(rows)
	const lines = [columns.map(csvCell).join(',')]
	for (const row of rows)
		lines.push(columns.map((column) => csvCell(row[column])).join(','))
	return `${lines.join('\n')}\n`
}

export function downloadText(filename: string, text: string, type: string) {
	const url = URL.createObjectURL(new Blob([text], { type }))
	const link = document.createElement('a')
	link.href = url
	link.download = filename
	link.click()
	URL.revokeObjectURL(url)
}

function isEmpty(value: unknown): boolean {
	return value === null || value === undefined
}

/**
 * The columns the result table shows: a column null in every row says
 * nothing (`_instance` on a single-instance read) and is left out, unless
 * every column is. JSON and the CSV export keep them all.
 */
export function filledColumns(
	rows: Record<string, unknown>[],
	columns: string[],
): string[] {
	const filled = columns.filter((column) =>
		rows.some((row) => !isEmpty(row[column])),
	)
	return filled.length ? filled : columns
}

/** Columns holding numbers and nothing else but nulls: right-aligned. */
export function numericColumns(
	rows: Record<string, unknown>[],
	columns: string[],
): string[] {
	return columns.filter(
		(column) =>
			rows.some((row) => typeof row[column] === 'number') &&
			rows.every(
				(row) => isEmpty(row[column]) || typeof row[column] === 'number',
			),
	)
}
