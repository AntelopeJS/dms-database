interface StorageEntry {
	schema: string
	table: string
	rows: number
}

interface OverviewHealth {
	status: 'ok' | 'down'
	latencyMs: number | null
	driver: string | null
	checkedAt: string | null
	error: string | null
	schemaCount: number
	tableCount: number
	relationCount: number
	indexCount: number
	totalRows: number
	storage: StorageEntry[]
}

const HEALTH_ENDPOINT = '/api/database/health'

const EMPTY_HEALTH: OverviewHealth = {
	status: 'ok',
	latencyMs: null,
	driver: null,
	checkedAt: null,
	error: null,
	schemaCount: 0,
	tableCount: 0,
	relationCount: 0,
	indexCount: 0,
	totalRows: 0,
	storage: [],
}

/** `refreshInterval` probes again on that interval while the page shows it. */
export function useDatabaseHealth(options: { refreshInterval?: number } = {}) {
	const read = useApiData<OverviewHealth>(HEALTH_ENDPOINT, {
		default: () => ({ ...EMPTY_HEALTH }),
		refreshInterval: options.refreshInterval,
	})
	const { data, pending, error, refresh } = read

	return {
		health: computed(() => data.value ?? { ...EMPTY_HEALTH }),
		isLoading: pending,
		error,
		refresh,
		/**
		 * Settles once the first probe is in, at once when it ran before:
		 * awaited in a setup, a client navigation shows the probe, not the
		 * empty health it replaces.
		 */
		ready: read.then(() => undefined),
	}
}
