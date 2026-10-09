import { createSharedComposable } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import {
	readFilterState,
	sourceQuery,
	type SchemasFilterState,
} from './filterState'
import { sortRows, useTableViewSort, type SortEntry } from './tableViewSort'

// The Schemas page's tables as its table view lists them: the same source
// route, the same filter bar state (read from the URL), the same order. The
// filter bar counts them; the inspector steps through them with J / K.
// Shared: the bar and the inspector host read one listing.

export const TABLES_SOURCE = '/api/database/tables/source'

// The table view of src/pages/schemas.ts: its key in the page, its default
// sort and its sortable columns.
export const SCHEMAS_TABLE_VIEW = {
	componentId: 'tables',
	defaultSort: { id: 'elementCount', desc: true } satisfies SortEntry,
	sortable: ['name', 'schema', 'elementCount', 'columnCount', 'indexCount'],
} as const

export interface SchemasListingRow extends Record<string, unknown> {
	id: string
	schema: string
	name: string
	elementCount: number
	columnCount: number
	indexCount: number
	relations: string[]
	modifiers: string[]
}

interface SourceResponse {
	results: SchemasListingRow[]
	total: number
	all?: number
}

export type ListingStatus = 'idle' | 'pending' | 'success' | 'error'

/**
 * The current route, read without `useDmsRoute()`: each call of it
 * reassigns the route's query, which the table view watches for its hidden
 * filters, so it lists again. A component mounted under the table view (its
 * empty state) calling it would list again on each mount, forever.
 */
export function useCurrentRoute() {
	return useDmsRouter().currentRoute
}

function useListing(pageId: string) {
	const route = useCurrentRoute()
	const { $authFetch } = useAuthFetch()
	const state = computed<SchemasFilterState>(() =>
		readFilterState(route.value.query),
	)
	const query = computed(() => sourceQuery(state.value))
	const sorting = useTableViewSort({
		componentId: SCHEMAS_TABLE_VIEW.componentId,
		pageId,
		defaultSort: SCHEMAS_TABLE_VIEW.defaultSort,
		sortable: SCHEMAS_TABLE_VIEW.sortable,
	})

	// The rows of the last answer stay while the next one loads.
	const rows = ref<SchemasListingRow[]>([])
	const all = ref<number | null>(null)
	const status = ref<ListingStatus>('idle')
	let latest = 0

	async function load() {
		const request = ++latest
		status.value = 'pending'
		try {
			const response = await $authFetch<SourceResponse>(TABLES_SOURCE, {
				query: query.value,
			})
			if (request !== latest) return
			rows.value = response.results
			all.value = response.all ?? null
			status.value = 'success'
		} catch {
			if (request === latest) status.value = 'error'
		}
	}

	// In the browser only: the server renders neither J / K nor the count.
	if (typeof window !== 'undefined') {
		watch(() => JSON.stringify(query.value), load, { immediate: true })
	}

	return {
		state,
		/** The rows in the table view's order. */
		rows: computed(() => sortRows(rows.value, sorting.value)),
		total: computed(() => rows.value.length),
		/** Registered tables before any filter; null until known. */
		all,
		status,
		sorting,
		refresh: load,
	}
}

export const useSchemasListing = createSharedComposable(useListing)
