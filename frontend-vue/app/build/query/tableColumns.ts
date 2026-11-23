import { type CellRow, type CellValue, isNumber } from '../utils/values'

function isEmpty(value: CellValue | undefined): boolean {
	return value === null || value === undefined
}

/**
 * The columns the result table shows: a column null in every row says
 * nothing (`_instance` on a single-instance read) and is left out, unless
 * every column is. JSON and the CSV export keep every column as it is.
 */
export function filledColumns(rows: CellRow[], columns: string[]): string[] {
	const filled = columns.filter((column) =>
		rows.some((row) => !isEmpty(row[column])),
	)
	return filled.length ? filled : columns
}

/** Columns holding numbers and nothing else but nulls: right-aligned. */
export function numericColumns(rows: CellRow[], columns: string[]): string[] {
	return columns.filter(
		(column) =>
			rows.some((row) => isNumber(row[column])) &&
			rows.every((row) => isEmpty(row[column]) || isNumber(row[column])),
	)
}
