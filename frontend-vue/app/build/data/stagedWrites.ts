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

export async function writeRows(
	rows: Iterable<[string, Record<string, unknown>]>,
	write: (rowId: string, body: Record<string, unknown>) => Promise<unknown>,
	/** Called once a row is settled: written, or gone. */
	onSettled?: (rowId: string) => void,
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
		try {
			await write(rowId, body)
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
		onSettled?.(rowId)
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
