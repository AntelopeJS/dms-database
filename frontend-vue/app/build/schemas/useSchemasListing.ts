import { computed } from 'vue'
import {
	readFilterState,
	sourceQuery,
	type SchemasFilterState,
} from './filterState'

const TABLES_SOURCE = '/api/database/tables/source'

interface SourceResponse {
	total: number
	all?: number
}

/**
 * What the Schemas page's filter bar counts: the tables its state (read from
 * the URL) lists, through the table view's own source route, and the tables
 * registered before any filter ("12 of 40").
 */
export function useSchemasListing() {
	const route = useDmsRoute()
	const state = computed<SchemasFilterState>(() => readFilterState(route.query))

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
