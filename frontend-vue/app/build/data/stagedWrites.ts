// Writes rows one call at a time, as a save and its undo do, and tells what
// went through: the rows written, the rows gone meanwhile (404, nothing left
// to write to) and the error that stopped the rest, if any. Rows are written
// in order and the first other failure stops the run, so the rows after it
// are left untouched.

const NOT_FOUND = 404

export interface RowWriteOutcome {
	written: string[]
	gone: string[]
	/** The failure that stopped the run; its row and the next ones are left. */
	error: unknown
	/** The rows neither written nor gone, in order. */
	left: string[]
}

function statusOf(error: unknown): number | undefined {
	const failure = error as { statusCode?: number; status?: number } | null
	return failure?.statusCode ?? failure?.status
}

export async function writeRows<T = unknown>(
	rows: Iterable<[string, Record<string, unknown>]>,
	write: (rowId: string, body: Record<string, unknown>) => Promise<T>,
	/** Called once a row is settled: written, with the write's answer, or gone. */
	onSettled?: (rowId: string, answer?: T) => void,
): Promise<RowWriteOutcome> {
	const outcome: RowWriteOutcome = {
		written: [],
		gone: [],
		error: null,
		left: [],
	}
	for (const [rowId, body] of rows) {
		if (outcome.error !== null) {
			outcome.left.push(rowId)
			continue
		}
		let answer: T | undefined
		try {
			answer = await write(rowId, body)
			outcome.written.push(rowId)
		} catch (error) {
			if (statusOf(error) !== NOT_FOUND) {
				// A failure without a message still stops the run.
				outcome.error = error ?? new Error('Write failed')
				outcome.left.push(rowId)
				continue
			}
			outcome.gone.push(rowId)
		}
		onSettled?.(rowId, answer)
	}
	return outcome
}

/** The changes of the rows given, in their order of the list. */
export function changesOf<T extends { rowId: string }>(
	changes: T[],
	rowIds: string[],
): T[] {
	const rows = new Set(rowIds)
	return changes.filter((change) => rows.has(change.rowId))
}

/** How the rows of a grid page are narrowed and ordered. */
export interface PageRefinement {
	sortKey: string | null
	search: string
	/** The fields a column filter narrows, with a value. */
	filtered: string[]
}

/**
 * Whether writing `fields` may take rows in or out of the page, or move them
 * in it: a field it is sorted or filtered by, or any field while a search
 * runs (it matches every column). The page is then read again; otherwise
 * the rows written stay where they are, as the server answered them.
 */
export function mayMoveRows(
	fields: Iterable<string>,
	refinement: PageRefinement,
): boolean {
	if (refinement.search !== '') return true
	const narrowing = new Set(refinement.filtered)
	if (refinement.sortKey) narrowing.add(refinement.sortKey)
	for (const field of fields) if (narrowing.has(field)) return true
	return false
}

/**
 * `rows` with the row the server answered a write with in place of the one of
 * the same id: the fields it holds replace theirs, the browse-only ones stay.
 */
export function withWrittenRow(
	rows: Record<string, unknown>[],
	written: Record<string, unknown>,
	idOf: (row: Record<string, unknown>) => string | null,
): Record<string, unknown>[] {
	const id = idOf(written)
	if (id === null) return rows
	return rows.map((row) => (idOf(row) === id ? { ...row, ...written } : row))
}
