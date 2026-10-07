// Edits of the data browser are staged (D-02): a changed cell keeps its old
// value until the user saves, and a save can be undone for a few seconds.
// Staged edits live per tab, keyed by row id then column, and survive
// switching tabs.

export interface StagedCell {
	before: unknown
	after: unknown
}

/** One staged change, as the review lists it. */
export interface StagedChange extends StagedCell {
	rowId: string
	field: string
}

type RowEdits = Record<string, StagedCell>
type TabEdits = Record<string, RowEdits>

/** Two cell values are the same when their JSON forms are. */
export function sameValue(left: unknown, right: unknown): boolean {
	if (left === right) return true
	try {
		return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
	} catch {
		return false
	}
}

export function useStagedEdits() {
	const edits = useDmsState<Record<string, TabEdits>>(
		'dms-database-staged-edits',
		() => ({}),
	)

	function tabEdits(tabId: string): TabEdits {
		return edits.value[tabId] ?? {}
	}

	function get(
		tabId: string,
		rowId: string,
		field: string,
	): StagedCell | undefined {
		return tabEdits(tabId)[rowId]?.[field]
	}

	/** Stages `after` over `before`; setting a cell back to `before` unstages it. */
	function stage(tabId: string, change: StagedChange) {
		const rows = { ...tabEdits(tabId) }
		const row = { ...(rows[change.rowId] ?? {}) }
		const before = row[change.field]?.before ?? change.before
		if (sameValue(before, change.after))
			Reflect.deleteProperty(row, change.field)
		else row[change.field] = { before, after: change.after }
		if (Object.keys(row).length === 0)
			Reflect.deleteProperty(rows, change.rowId)
		else rows[change.rowId] = row
		edits.value = { ...edits.value, [tabId]: rows }
	}

	function list(tabId: string): StagedChange[] {
		return Object.entries(tabEdits(tabId)).flatMap(([rowId, row]) =>
			Object.entries(row).map(([field, cell]) => ({ rowId, field, ...cell })),
		)
	}

	function count(tabId: string): number {
		return list(tabId).length
	}

	function rowCount(tabId: string, rowId: string): number {
		return Object.keys(tabEdits(tabId)[rowId] ?? {}).length
	}

	function discard(tabId: string, rowIds?: string[]) {
		if (!rowIds) {
			const next = { ...edits.value }
			Reflect.deleteProperty(next, tabId)
			edits.value = next
			return
		}
		const rows = { ...tabEdits(tabId) }
		for (const rowId of rowIds) Reflect.deleteProperty(rows, rowId)
		edits.value = { ...edits.value, [tabId]: rows }
	}

	/** The staged values of a row, as the edit route takes them. */
	function rowBody(tabId: string, rowId: string): Record<string, unknown> {
		return Object.fromEntries(
			Object.entries(tabEdits(tabId)[rowId] ?? {}).map(([field, cell]) => [
				field,
				cell.after,
			]),
		)
	}

	function rowIds(tabId: string): string[] {
		return Object.keys(tabEdits(tabId))
	}

	return { get, stage, list, count, rowCount, discard, rowBody, rowIds }
}

/** The values a saved change replaced, grouped per row: what an undo writes. */
export function undoBodies(
	changes: StagedChange[],
): Map<string, Record<string, unknown>> {
	const bodies = new Map<string, Record<string, unknown>>()
	for (const change of changes) {
		const body = bodies.get(change.rowId) ?? {}
		// An empty cell is cleared with null: the edit route skips undefined.
		body[change.field] = change.before ?? null
		bodies.set(change.rowId, body)
	}
	return bodies
}
