import { computed, ref, watch } from 'vue'
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

type ListingStatus = 'idle' | 'pending' | 'success' | 'error'

export function useSchemasListing() {
	const route = useDmsRoute()
	const { $authFetch } = useAuthFetch()
	const state = computed<SchemasFilterState>(() => readFilterState(route.query))
	const query = computed(() => sourceQuery(state.value))

	// The counts of the last answer stay while the next one loads.
	const total = ref(0)
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
			total.value = response.total
			all.value = response.all ?? null
			status.value = 'success'
		} catch {
			if (request === latest) status.value = 'error'
		}
	}

	// In the browser only: the server renders no count.
	if (typeof window !== 'undefined') {
		watch(() => JSON.stringify(query.value), load, { immediate: true })
	}

	return {
		state,
		/** Tables the bar's filters list. */
		total,
		/** Registered tables before any filter; null until known. */
		all,
		status,
	}
}
