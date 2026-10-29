import type { GridColumn } from '../composables/useDataBrowserGrid'
import type { TableSummary } from '../composables/useDatabaseSchemas'

/** Primary key assumed when the backend reports none (MongoDB's implicit id). */
export const DEFAULT_PRIMARY_KEY = '_id'

export interface ColumnsResponse {
	columns: string[]
	types: Record<string, string>
	primaryKey: string | null
}

export interface ListResponse {
	results: Record<string, unknown>[]
	total: number
	primaryKey: string | null
}

/**
 * The grid's columns: the sampled ones, or the introspected fields when the
 * sample is empty or failed.
 */
export function columnsOf(
	meta: ColumnsResponse | null,
	primaryKey: string | null,
	table: TableSummary | undefined,
): GridColumn[] {
	const sampled = meta?.columns ?? []
	const names = sampled.length > 0 ? sampled : Object.keys(table?.fields ?? {})
	return names.map((name) => ({
		name,
		type: meta?.types[name] ?? 'string',
		isPrimaryKey: name === (primaryKey ?? DEFAULT_PRIMARY_KEY),
	}))
}

export interface GridCell {
	r: number
	c: number
}

const MOVES: Record<string, (cell: GridCell) => GridCell> = {
	ArrowUp: ({ r, c }) => ({ r: r - 1, c }),
	ArrowDown: ({ r, c }) => ({ r: r + 1, c }),
	ArrowLeft: ({ r, c }) => ({ r, c: c - 1 }),
	ArrowRight: ({ r, c }) => ({ r, c: c + 1 }),
}

/**
 * The cell an arrow key moves the focus to, kept inside a grid of `rows` by
 * `columns`; null for any other key.
 */
export function moveFocus(
	key: string,
	from: GridCell,
	rows: number,
	columns: number,
): GridCell | null {
	const move = MOVES[key]
	if (!move) return null
	const next = move(from)
	return {
		r: Math.max(0, Math.min(rows - 1, next.r)),
		c: Math.max(0, Math.min(columns - 1, next.c)),
	}
}
