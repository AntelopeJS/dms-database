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

export function useDatabaseHealth() {
	const { useFetchAuth } = useAuthFetch()
	const { data, pending, error, refresh } = useFetchAuth<OverviewHealth>(
		HEALTH_ENDPOINT,
		{ default: () => ({ ...EMPTY_HEALTH }) },
	)

	return {
		health: computed(() => data.value ?? { ...EMPTY_HEALTH }),
		isLoading: pending,
		error,
		refresh,
	}
}
