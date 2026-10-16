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

/** A schema's diagram as stored: its layout and its notes. */
export interface StoredDiagram {
	schema: string
	positions: DiagramPositions
	notes: DiagramNote[]
}

const BASE = '/api/database/diagram'
// A request that hangs fails after this (ofetch's own `timeout`), so the
// canvas shows the error and its "Try again" instead of "Saving…" forever.
const REQUEST_TIMEOUT_MS = 15_000

export function useDiagramPersistence() {
	const { $authFetch } = useAuthFetch()

	// The schema whose diagram is read: in the browser only, when the canvas
	// asks, since it draws and edits a working copy of it.
	const readSchema = shallowRef<string | null>(null)
	const stored = useApiData<StoredDiagram>(
		() =>
			readSchema.value ? `dms-database:diagram:${readSchema.value}` : null,
		async ({ $authFetch: read, signal }) => {
			const schema = readSchema.value as string
			const [layout, notes] = await Promise.all([
				read<{ positions: DiagramPositions }>(
					`${BASE}/layout/${encodeURIComponent(schema)}`,
					{ timeout: REQUEST_TIMEOUT_MS, signal },
				),
				read<{ items: DiagramNote[] }>(`${BASE}/notes`, {
					query: { schema },
					timeout: REQUEST_TIMEOUT_MS,
					signal,
				}),
			])
			return {
				schema,
				positions: layout.positions ?? {},
				notes: notes.items ?? [],
			}
		},
		{
			immediate: false,
			server: false,
			watch: false,
			refreshOnPageRefresh: false,
		},
	)

	/** Reads a schema's layout and notes; throws when they cannot be read. */
	async function readDiagram(schema: string): Promise<StoredDiagram> {
		readSchema.value = schema
		await stored.execute()
		const diagram = stored.data.value
		if (stored.error.value || diagram?.schema !== schema)
			throw stored.error.value ?? new Error('Diagram not read')
		return diagram
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
				timeout: REQUEST_TIMEOUT_MS,
			},
		)
	}

	async function createNote(payload: DiagramNoteCreate): Promise<DiagramNote> {
		return $authFetch<DiagramNote>(`${BASE}/notes`, {
			method: 'POST',
			body: payload,
			timeout: REQUEST_TIMEOUT_MS,
		})
	}

	async function updateNote(
		id: string,
		patch: DiagramNoteUpdate,
	): Promise<DiagramNote> {
		return $authFetch<DiagramNote>(`${BASE}/notes/${encodeURIComponent(id)}`, {
			method: 'PUT',
			body: patch,
			timeout: REQUEST_TIMEOUT_MS,
		})
	}

	async function deleteNote(id: string): Promise<void> {
		await $authFetch<{ success: boolean }>(
			`${BASE}/notes/${encodeURIComponent(id)}`,
			{ method: 'DELETE', timeout: REQUEST_TIMEOUT_MS },
		)
	}

	return {
		readDiagram,
		saveLayout,
		createNote,
		updateNote,
		deleteNote,
	}
}
