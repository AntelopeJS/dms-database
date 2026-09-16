export interface StorageEntry {
	schema: string;
	table: string;
	rows: number;
}

export interface OverviewHealth {
	status: "ok" | "down";
	latencyMs: number | null;
	driver: string | null;
	pool: string | null;
	collections: number;
	schemaCount: number;
	tableCount: number;
	indexCount: number;
	totalRows: number;
	sizeBytes: number | null;
	storage: StorageEntry[];
}

const HEALTH_ENDPOINT = "/api/database/health";

const EMPTY_HEALTH: OverviewHealth = {
	status: "down",
	latencyMs: null,
	driver: null,
	pool: null,
	collections: 0,
	schemaCount: 0,
	tableCount: 0,
	indexCount: 0,
	totalRows: 0,
	sizeBytes: null,
	storage: [],
};

export function useDatabaseHealth() {
	const { useFetchAuth } = useAuthFetch();
	const { data, pending, error, refresh } = useFetchAuth<OverviewHealth>(
		HEALTH_ENDPOINT,
		{ default: () => ({ ...EMPTY_HEALTH }) },
	);

	return {
		health: computed(() => data.value ?? { ...EMPTY_HEALTH }),
		isLoading: pending,
		error,
		refresh,
	};
}
