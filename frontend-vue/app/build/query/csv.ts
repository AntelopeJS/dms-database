import { type CellRow, type CellValue, isObject } from '../utils/values'

const NEEDS_QUOTES = /[",\n\r]/

function csvCell(value: CellValue | undefined): string {
	if (value === null || value === undefined) return ''
	const text = isObject(value) ? JSON.stringify(value) : String(value)
	return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The columns of every row, in the order they first appear. */
export function resultColumns(rows: CellRow[]): string[] {
	const columns = new Set<string>()
	for (const row of rows) for (const key of Object.keys(row)) columns.add(key)
	return [...columns]
}

/** A result as CSV, the columns of every row in the order they first appear. */
export function toCsv(rows: CellRow[]): string {
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
