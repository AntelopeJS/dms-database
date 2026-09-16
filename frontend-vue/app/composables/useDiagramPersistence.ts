export interface DiagramPosition {
	x: number;
	y: number;
}

export type DiagramPositions = Record<string, DiagramPosition>;

export interface DiagramNote {
	id: string;
	schemaName: string;
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface DiagramNoteCreate {
	schemaName: string;
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color?: string;
}

export type DiagramNoteUpdate = Partial<
	Pick<DiagramNote, "text" | "x" | "y" | "width" | "height" | "color">
>;

const BASE = "/api/database/diagram";

export function useDiagramPersistence() {
	const { $authFetch } = useAuthFetch();

	async function fetchLayout(schema: string): Promise<DiagramPositions> {
		const res = await $authFetch<{ positions: DiagramPositions }>(
			`${BASE}/layout/${encodeURIComponent(schema)}`,
		);
		return res.positions ?? {};
	}

	async function saveLayout(
		schema: string,
		positions: DiagramPositions,
	): Promise<void> {
		await $authFetch<{ success: boolean }>(
			`${BASE}/layout/${encodeURIComponent(schema)}`,
			{
				method: "PUT",
				body: { positions },
			},
		);
	}

	async function fetchNotes(schema: string): Promise<DiagramNote[]> {
		const res = await $authFetch<{ items: DiagramNote[] }>(`${BASE}/notes`, {
			query: { schema },
		});
		return res.items ?? [];
	}

	async function createNote(payload: DiagramNoteCreate): Promise<DiagramNote> {
		return $authFetch<DiagramNote>(`${BASE}/notes`, {
			method: "POST",
			body: payload,
		});
	}

	async function updateNote(
		id: string,
		patch: DiagramNoteUpdate,
	): Promise<DiagramNote> {
		return $authFetch<DiagramNote>(
			`${BASE}/notes/${encodeURIComponent(id)}`,
			{ method: "PUT", body: patch },
		);
	}

	async function deleteNote(id: string): Promise<void> {
		await $authFetch<{ success: boolean }>(
			`${BASE}/notes/${encodeURIComponent(id)}`,
			{ method: "DELETE" },
		);
	}

	return {
		fetchLayout,
		saveLayout,
		fetchNotes,
		createNote,
		updateNote,
		deleteNote,
	};
}
