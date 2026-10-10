import { useEventListener } from '@vueuse/core'
import { ref, type Ref } from 'vue'

// The order the DMS table view lists its rows in, for what steps through
// them outside it (J / K in the Schemas inspector). The table view exposes
// no API for it: it keeps its sort in the `user-preferences` cookie, under
// `tables.<componentId>.<pageId>.sorting`, announces each change with a
// `DmsComponent.TableView.SortChange` window event (not on mount), and sorts
// a source's rows itself (`processSourceRows`, dms-ui layer). Everything
// this module depends on in the DMS is in this file; should a DMS release
// move it, J / K fall back to the default order.

/** One sorted column, as TanStack and the table view hold it. */
export interface SortEntry {
	id: string
	desc: boolean
}

export interface TableViewSortConfig {
	/** The table view's key in its page (its static field name). */
	componentId: string
	/** The page's full id, as components receive it. */
	pageId: string
	/** The table view's `defaultSort`. */
	defaultSort?: SortEntry
	/** The sortable columns: the table view drops a sort on any other. */
	sortable: readonly string[]
}

const SORT_CHANGE_EVENT = 'DmsComponent.TableView.SortChange'
const PREFERENCES_ROOT = 'tables'
const SORTING_KEY = 'sorting'

/** Where the table view keeps its sort among the user's preferences. */
export function sortingPreferencePath(
	componentId: string,
	pageId: string,
): string {
	return [PREFERENCES_ROOT, componentId, pageId, SORTING_KEY].join('.')
}

/**
 * The sort the table view lists by: one sortable column, else none (as its
 * `sanitizeSorting`).
 */
export function sanitizeSorting(
	sorting: unknown,
	sortable: readonly string[],
): SortEntry[] {
	const [first] = Array.isArray(sorting) ? sorting : []
	if (!first || typeof first !== 'object') return []
	const { id, desc } = first as { id?: unknown; desc?: unknown }
	if (typeof id !== 'string' || !sortable.includes(id)) return []
	return [{ id, desc: desc === true }]
}

/**
 * The sort a table view opens with: the saved one (an empty one included:
 * the user turned the sort off), else its default.
 */
export function initialSorting(
	saved: unknown,
	config: Pick<TableViewSortConfig, 'defaultSort' | 'sortable'>,
): SortEntry[] {
	if (saved !== undefined && saved !== null)
		return sanitizeSorting(saved, config.sortable)
	return sanitizeSorting(
		config.defaultSort ? [config.defaultSort] : [],
		config.sortable,
	)
}

function textOf(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

/** How the table view compares two cells of a source's rows. */
export function compareValues(left: unknown, right: unknown): number {
	if (typeof left === 'number' && typeof right === 'number') return left - right
	return textOf(left).localeCompare(textOf(right), undefined, { numeric: true })
}

/**
 * The rows in the table view's order: stable, so equal cells keep the
 * source's order; unsorted, they keep it all.
 */
export function sortRows<T extends Record<string, unknown>>(
	rows: readonly T[],
	sorting: readonly SortEntry[],
): T[] {
	const [entry] = sorting
	if (!entry) return [...rows]
	const direction = entry.desc ? -1 : 1
	return [...rows].sort(
		(left, right) => direction * compareValues(left[entry.id], right[entry.id]),
	)
}

interface SortChangeDetail {
	component?: unknown
	data?: unknown
}

/** The table view's current sort, following its changes. */
export function useTableViewSort(
	config: TableViewSortConfig,
): Ref<SortEntry[]> {
	const { getPreference } = usePreferences()
	const saved = getPreference<unknown>(
		sortingPreferencePath(config.componentId, config.pageId),
	)
	const sorting = ref<SortEntry[]>(initialSorting(saved, config))
	if (typeof window !== 'undefined') {
		useEventListener(window, SORT_CHANGE_EVENT, (event: Event) => {
			const detail = (event as CustomEvent<SortChangeDetail>).detail
			if (detail?.component !== config.componentId) return
			sorting.value = sanitizeSorting(detail.data, config.sortable)
		})
	}
	return sorting
}
