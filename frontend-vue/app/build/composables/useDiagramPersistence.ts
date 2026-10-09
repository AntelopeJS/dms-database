export interface DiagramPosition {
	x: number
	y: number
}

export type DiagramPositions = Record<string, DiagramPosition>

export interface DiagramNote {
	id: string
	schemaName: string
	text: string
	x: number
	y: number
	width: number
	height: number
	color: string | null
	createdAt: string
	updatedAt: string
}

export interface DiagramNoteCreate {
	schemaName: string
	text: string
	x: number
	y: number
	width: number
	height: number
	color?: string
}

export type DiagramNoteUpdate = Partial<
	Pick<DiagramNote, 'text' | 'x' | 'y' | 'width' | 'height' | 'color'>
>

const BASE = '/api/database/diagram'
// A request that hangs fails after this, so the canvas shows the error and
// its "Try again" instead of "Saving…" forever.
export const DIAGRAM_REQUEST_TIMEOUT_MS = 15_000

function timeout(): AbortSignal {
	return AbortSignal.timeout(DIAGRAM_REQUEST_TIMEOUT_MS)
}

export function useDiagramPersistence() {
	const { $authFetch } = useAuthFetch()

	async function fetchLayout(schema: string): Promise<DiagramPositions> {
		const res = await $authFetch<{ positions: DiagramPositions }>(
			`${BASE}/layout/${encodeURIComponent(schema)}`,
			{ signal: timeout() },
		)
		return res.positions ?? {}
	}

	async function saveLayout(
		schema: string,
		positions: DiagramPositions,
	): Promise<void> {
		await $authFetch<{ success: boolean }>(
			`${BASE}/layout/${encodeURIComponent(schema)}`,
			{
				method: 'PUT',
				body: { positions },
				signal: timeout(),
			},
		)
	}

	async function fetchNotes(schema: string): Promise<DiagramNote[]> {
		const res = await $authFetch<{ items: DiagramNote[] }>(`${BASE}/notes`, {
			query: { schema },
			signal: timeout(),
		})
		return res.items ?? []
	}

	async function createNote(payload: DiagramNoteCreate): Promise<DiagramNote> {
		return $authFetch<DiagramNote>(`${BASE}/notes`, {
			method: 'POST',
			body: payload,
			signal: timeout(),
		})
	}

	async function updateNote(
		id: string,
		patch: DiagramNoteUpdate,
	): Promise<DiagramNote> {
		return $authFetch<DiagramNote>(`${BASE}/notes/${encodeURIComponent(id)}`, {
			method: 'PUT',
			body: patch,
			signal: timeout(),
		})
	}

	async function deleteNote(id: string): Promise<void> {
		await $authFetch<{ success: boolean }>(
			`${BASE}/notes/${encodeURIComponent(id)}`,
			{ method: 'DELETE', signal: timeout() },
		)
	}

	return {
		fetchLayout,
		saveLayout,
		fetchNotes,
		createNote,
		updateNote,
		deleteNote,
	}
}
