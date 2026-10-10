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
