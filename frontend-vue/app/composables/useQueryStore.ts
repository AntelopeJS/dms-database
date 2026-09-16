export type QueryLanguage = "aql";
export type QueryScope = "me" | "shared";

export interface SavedQuery {
	id: string;
	userId: string;
	name: string;
	description: string;
	query: Record<string, unknown>;
	source: string;
	language: QueryLanguage;
	shared: boolean;
	createdAt: string;
}

export interface HistoryEntry {
	id: string;
	userId: string;
	query: Record<string, unknown>;
	source: string;
	language: QueryLanguage;
	executedAt: string;
	durationMs: number;
	rowCount: number;
}

export interface ExecuteResult {
	rows: Record<string, unknown>[];
	executedAt: string;
	durationMs: number;
	error?: string;
}

export interface SaveQueryInput {
	name: string;
	description: string;
	query: Record<string, unknown>;
	source: string;
	language: QueryLanguage;
	shared: boolean;
}

const QUERY_BASE = "/api/database/query";

export function useQueryStore() {
	const { $authFetch } = useAuthFetch();

	const savedQueries = ref<SavedQuery[]>([]);
	const historyItems = ref<HistoryEntry[]>([]);
	const historyTotal = ref(0);

	async function fetchSaved(scope: QueryScope): Promise<void> {
		const response = await $authFetch<{ items: SavedQuery[] }>(
			`${QUERY_BASE}/saved`,
			{ query: { scope } },
		);
		savedQueries.value = response.items ?? [];
	}

	async function fetchHistory(limit: number, offset: number): Promise<void> {
		const response = await $authFetch<{
			items: HistoryEntry[];
			total: number;
		}>(`${QUERY_BASE}/history`, {
			query: { limit, offset },
		});
		historyItems.value = response.items ?? [];
		historyTotal.value = response.total ?? 0;
	}

	async function executeQuery(
		query: Record<string, unknown>,
		source: string,
		language: QueryLanguage,
	): Promise<ExecuteResult> {
		return $authFetch<ExecuteResult>(`${QUERY_BASE}/execute`, {
			method: "POST",
			body: { query, source, language },
		});
	}

	async function saveQuery(input: SaveQueryInput): Promise<SavedQuery> {
		return $authFetch<SavedQuery>(`${QUERY_BASE}/saved`, {
			method: "POST",
			body: input,
		});
	}

	async function updateSaved(
		id: string,
		input: SaveQueryInput,
	): Promise<SavedQuery> {
		return $authFetch<SavedQuery>(
			`${QUERY_BASE}/saved/${encodeURIComponent(id)}`,
			{ method: "PUT", body: input },
		);
	}

	async function deleteSaved(id: string): Promise<void> {
		await $authFetch<{ success: boolean }>(
			`${QUERY_BASE}/saved/${encodeURIComponent(id)}`,
			{ method: "DELETE" },
		);
	}

	return {
		savedQueries,
		historyItems,
		historyTotal,
		fetchSaved,
		fetchHistory,
		executeQuery,
		saveQuery,
		updateSaved,
		deleteSaved,
	};
}
