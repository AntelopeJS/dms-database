import { computed } from 'vue'
import {
	readFilterState,
	sourceQuery,
	type SchemasFilterState,
} from './filterState'

// What the Schemas page's filter bar counts: the tables its state (read from
// the URL) lists, through the table view's own source route, and the tables
// registered before any filter ("12 of 40").

const TABLES_SOURCE = '/api/database/tables/source'

interface SourceResponse {
	total: number
	all?: number
}

export function useSchemasListing() {
	const route = useDmsRoute()
	const state = computed<SchemasFilterState>(() => readFilterState(route.query))

	// Rendered on the server and handed over, the counts only (not the rows
	// the route lists); the counts of the last answer stay while the next one
	// loads.
	const { data, status } = useApiData<SourceResponse>(TABLES_SOURCE, {
		query: () => sourceQuery(state.value),
		pick: ['total', 'all'],
	})

	return {
		state,
		/** Tables the bar's filters list. */
		total: computed(() => data.value?.total ?? 0),
		/** Registered tables before any filter; null until known. */
		all: computed(() => data.value?.all ?? null),
		status,
	}
}
