import type { CellValue } from '../utils/values'
import { DEFAULT_INSTANCE_VALUE } from './browserInstance'
import type { BrowserTab } from './useDataBrowserTabs'

export interface ColumnFilterState {
	mode: 'is' | 'contains'
	value: string
}

interface GridState {
	page: number
	pageSize: number
	sortKey: string | null
	sortDirection: 'asc' | 'desc'
	search: string
	filters: Record<string, ColumnFilterState>
	columnWidths: Record<string, number>
}

export interface GridColumn {
	name: string
	/**
	 * Coarse runtime type sampled by the backend: string | number | boolean |
	 * object | array | null | undefined.
	 */
	type: string
	isPrimaryKey: boolean
}

export interface GridData {
	columns: GridColumn[]
	rows: Record<string, CellValue>[]
	total: number
	primaryKey: string | null
}

export const GRID_PAGE_SIZES = [25, 50, 100, 200]

function defaultGridState(): GridState {
	return {
		page: 0,
		pageSize: 50,
		sortKey: null,
		sortDirection: 'asc',
		search: '',
		filters: {},
		columnWidths: {},
	}
}

/**
 * Per-tab grid state (paging, sort, filters, column widths), keyed by
 * BrowserTab.id. The rows themselves are `useApiData`'s: a tab switched back
 * to shows its last page at once and reads it again.
 */
export function useDataBrowserGrid() {
	const states = useDmsState<Record<string, GridState>>(
		'dms-database-grid-states',
		() => ({}),
	)

	function getState(tabId: string): GridState {
		if (!states.value[tabId]) states.value[tabId] = defaultGridState()
		return states.value[tabId]
	}

	function drop(tabId: string) {
		Reflect.deleteProperty(states.value, tabId)
	}

	function carry(fromId: string, toId: string) {
		const from = states.value[fromId]
		if (!from) return
		states.value[toId] = {
			...from,
			filters: { ...from.filters },
			columnWidths: { ...from.columnWidths },
			page: 0,
		}
	}

	return {
		getState,
		/** Forgets everything about a closed tab. */
		drop,
		/**
		 * A tab switched to another instance keeps what the user narrowed the
		 * rows to (search, filters, sort, page size, widths), from its first page.
		 */
		carry,
	}
}

/**
 * Reserved by the wire protocol for table selection (the backend's
 * SELECTION_FILTER_KEYS): a data filter on a column literally named `schema`,
 * `table` or `instance` would clobber the selection parameters, so it is never
 * emitted and the filter UI is disabled for these columns.
 */
const RESERVED_FILTER_FIELDS = new Set(['schema', 'table', 'instance'])

export function isReservedFilterField(field: string): boolean {
	return RESERVED_FILTER_FIELDS.has(field)
}

/**
 * Normalized (empty-pruned, reserved-pruned, name-sorted) filter entries: the
 * single source for both the wire query and the cache key, so key-insertion
 * order or an empty draft can't cause spurious cache misses.
 */
function activeFilterEntries(
	state: GridState,
): Array<[string, ColumnFilterState]> {
	return Object.entries(state.filters)
		.filter(([field, filter]) => filter.value && !isReservedFilterField(field))
		.sort(([a], [b]) => a.localeCompare(b))
}

/**
 * Single encoder for the `<mode>:<value>` wire tokens parseFilter decodes
 * server-side (src/utils/query.ts): the grammar is defined here once instead
 * of scattered string literals.
 */
function filterToken(mode: 'is' | 'contains', value: string): string {
	return `${mode}:${value}`
}

export function isFilterToken(value: string): string {
	return filterToken('is', value)
}

/**
 * Selection filters identifying the table, in the wire format the browse
 * backend decodes (see resolveSelection in src/routes/data.ts).
 */
export function browseSelectionQuery(tab: BrowserTab) {
	const filterSchema = isFilterToken(tab.schema)
	const filterTable = isFilterToken(tab.table)
	return tab.instance === DEFAULT_INSTANCE_VALUE
		? { filter_schema: filterSchema, filter_table: filterTable }
		: {
				filter_schema: filterSchema,
				filter_table: filterTable,
				filter_instance: isFilterToken(tab.instance),
			}
}

export function browseListQuery(state: GridState) {
	const entries: [string, string | number][] = [
		['offset', state.page * state.pageSize],
		['limit', state.pageSize],
		['sortDirection', state.sortDirection],
	]
	if (state.sortKey) entries.push(['sortKey', state.sortKey])
	if (state.search) entries.push(['search', state.search])
	for (const [field, filter] of activeFilterEntries(state)) {
		entries.push([`filter_${field}`, filterToken(filter.mode, filter.value)])
	}
	return Object.fromEntries(entries)
}
