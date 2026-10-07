export type QueryLanguage = 'aql'
export type QueryScope = 'me' | 'shared'

export interface SavedQuery {
	id: string
	userId: string
	name: string
	description: string
	query: Record<string, unknown>
	source: string
	language: QueryLanguage
	shared: boolean
	createdAt: string
	updatedAt: string
	/** Who saved it, on the team's shared queries. */
	ownerName?: string
}

export type QueryRunStatus = 'ok' | 'error'

export interface HistoryEntry {
	id: string
	userId: string
	query: Record<string, unknown>
	source: string
	language: QueryLanguage
	executedAt: string
	durationMs: number
	rowCount: number
	status: QueryRunStatus
	/** Whether the query wrote. */
	mutation: boolean
	error?: string
}

export interface ExecuteResult {
	rows: Record<string, unknown>[]
	/** Rows the query answered; above `rows.length` when they were cut. */
	rowCount: number
	truncated: boolean
	mutation: boolean
	executedAt: string
	durationMs: number
}

export type QueryOperation = 'read' | 'insert' | 'update' | 'replace' | 'delete'

/** What a query would write, measured before it runs. */
export interface DryRunResult {
	operation: QueryOperation
	schema?: string
	instance?: string
	table?: string
	/** Null when the write is nested and cannot be measured on its own. */
	rows: number | null
}

export interface SaveQueryInput {
	name: string
	description: string
	query: Record<string, unknown>
	source: string
	language: QueryLanguage
	shared: boolean
}

const QUERY_BASE = '/api/database/query'

export function useQueryStore() {
	const { $authFetch } = useAuthFetch()

	const savedQueries = ref<SavedQuery[]>([])
	const historyItems = ref<HistoryEntry[]>([])
	const historyTotal = ref(0)

	async function fetchSaved(scope: QueryScope): Promise<void> {
		const response = await $authFetch<{ items: SavedQuery[] }>(
			`${QUERY_BASE}/saved`,
			{ query: { scope } },
		)
		savedQueries.value = response.items ?? []
	}

	async function fetchHistoryEntry(id: string): Promise<HistoryEntry> {
		return $authFetch<HistoryEntry>(
			`${QUERY_BASE}/history/${encodeURIComponent(id)}`,
		)
	}

	async function clearHistory(): Promise<void> {
		await $authFetch<{ success: boolean }>(`${QUERY_BASE}/history`, {
			method: 'DELETE',
		})
		historyItems.value = []
		historyTotal.value = 0
	}

	async function dryRun(query: Record<string, unknown>): Promise<DryRunResult> {
		return $authFetch<DryRunResult>(`${QUERY_BASE}/dry-run`, {
			method: 'POST',
			body: { query },
		})
	}

	async function fetchHistory(limit: number, offset: number): Promise<void> {
		const response = await $authFetch<{
			items: HistoryEntry[]
			total: number
		}>(`${QUERY_BASE}/history`, {
			query: { limit, offset },
		})
		historyItems.value = response.items ?? []
		historyTotal.value = response.total ?? 0
	}

	async function executeQuery(
		query: Record<string, unknown>,
		source: string,
		language: QueryLanguage,
	): Promise<ExecuteResult> {
		return $authFetch<ExecuteResult>(`${QUERY_BASE}/execute`, {
			method: 'POST',
			body: { query, source, language },
		})
	}

	async function saveQuery(input: SaveQueryInput): Promise<SavedQuery> {
		return $authFetch<SavedQuery>(`${QUERY_BASE}/saved`, {
			method: 'POST',
			body: input,
		})
	}

	async function updateSaved(
		id: string,
		input: SaveQueryInput,
	): Promise<SavedQuery> {
		return $authFetch<SavedQuery>(
			`${QUERY_BASE}/saved/${encodeURIComponent(id)}`,
			{ method: 'PUT', body: input },
		)
	}

	async function deleteSaved(id: string): Promise<void> {
		await $authFetch<{ success: boolean }>(
			`${QUERY_BASE}/saved/${encodeURIComponent(id)}`,
			{ method: 'DELETE' },
		)
	}

	return {
		savedQueries,
		historyItems,
		historyTotal,
		fetchSaved,
		fetchHistory,
		fetchHistoryEntry,
		clearHistory,
		dryRun,
		executeQuery,
		saveQuery,
		updateSaved,
		deleteSaved,
	}
}
