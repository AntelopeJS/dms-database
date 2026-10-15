export type QueryLanguage = 'aql'

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

import { HISTORY_KEPT } from '../query/runs'

const QUERY_BASE = '/api/database/query'

/**
 * The query console's library and requests. The library (the caller's saved
 * queries, the team's shared ones, the runs the server keeps) is read as the
 * console sets up: a server render reads it and hands it over with the page.
 * Every write is a request of its own, after which the console refreshes
 * the part of the library it changed.
 */
export function useQueryStore() {
	const { $authFetch } = useAuthFetch()

	const saved = useApiData<{ items: SavedQuery[] }>(`${QUERY_BASE}/saved`, {
		query: { scope: 'me' },
	})
	const shared = useApiData<{ items: SavedQuery[] }>(`${QUERY_BASE}/saved`, {
		query: { scope: 'shared' },
	})
	const history = useApiData<{ items: HistoryEntry[] }>(
		`${QUERY_BASE}/history`,
		{ query: { limit: HISTORY_KEPT } },
	)
	const reads = [saved, shared, history]

	/** The saved queries and the shared ones, read again. */
	async function refreshSaved(): Promise<void> {
		await Promise.all([saved.refresh(), shared.refresh()])
	}

	// A run a link names (`?history=`), read when the console opens it.
	const entryId = shallowRef<string | null>(null)
	const entry = useApiData<HistoryEntry>(
		() =>
			entryId.value
				? `${QUERY_BASE}/history/${encodeURIComponent(entryId.value)}`
				: null,
		{
			immediate: false,
			server: false,
			watch: false,
			refreshOnPageRefresh: false,
		},
	)

	async function fetchHistoryEntry(id: string): Promise<HistoryEntry> {
		entryId.value = id
		await entry.execute()
		if (entry.error.value || !entry.data.value)
			throw entry.error.value ?? new Error('History entry not read')
		return entry.data.value
	}

	async function clearHistory(): Promise<void> {
		await $authFetch<{ success: boolean }>(`${QUERY_BASE}/history`, {
			method: 'DELETE',
		})
		history.data.value = { items: [] }
	}

	async function dryRun(query: Record<string, unknown>): Promise<DryRunResult> {
		return $authFetch<DryRunResult>(`${QUERY_BASE}/dry-run`, {
			method: 'POST',
			body: { query },
		})
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
		/** The caller's saved queries. A failed refresh keeps the last list. */
		savedQueries: computed(() => saved.data.value?.items ?? []),
		/** The queries shared with the team, the caller's own included. */
		sharedQueries: computed(() => shared.data.value?.items ?? []),
		/** Every run the server keeps, newest first. */
		historyItems: computed(() => history.data.value?.items ?? []),
		/** The library's first read is still running. */
		libraryLoading: computed(() =>
			reads.some(
				(read) => read.data.value === null && read.status.value !== 'error',
			),
		),
		/** Settles once the library's first read did, failed or not. */
		libraryRead: Promise.all(reads).then(() => undefined),
		refreshSaved,
		refreshHistory: () => history.refresh(),
		fetchHistoryEntry,
		clearHistory,
		dryRun,
		executeQuery,
		saveQuery,
		updateSaved,
		deleteSaved,
	}
}
