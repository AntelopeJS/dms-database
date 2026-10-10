// How the result table lays out its columns: which ones it shows and which
// it right-aligns. JSON and the CSV export keep every column as it is.

function isEmpty(value: unknown): boolean {
	return value === null || value === undefined
}

/**
 * The columns the result table shows: a column null in every row says
 * nothing (`_instance` on a single-instance read) and is left out, unless
 * every column is.
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
