import type {
	DiagramNote,
	DiagramNoteCreate,
	DiagramNoteUpdate,
	DiagramPositions,
} from '../composables/useDiagramPersistence'
import type { NoteDraft } from './graph'
import { clonePositions, type DiagramState } from './history'

// Saves the diagram as it changes (D-10): the layout and the notes are
// compared with what was last stored, and only the differences are written.
// One DiagramSync belongs to one schema: it only ever writes under its id.

export interface DiagramStore {
	saveLayout(schema: string, positions: DiagramPositions): Promise<void>
	createNote(payload: DiagramNoteCreate): Promise<DiagramNote>
	updateNote(id: string, patch: DiagramNoteUpdate): Promise<DiagramNote>
	deleteNote(id: string): Promise<void>
}

const NOTE_FIELDS = ['text', 'x', 'y', 'width', 'height', 'color'] as const

function noteChanged(saved: NoteDraft, current: NoteDraft): boolean {
	return NOTE_FIELDS.some((field) => saved[field] !== current[field])
}

function notePatch(note: NoteDraft): DiagramNoteUpdate {
	return {
		text: note.text,
		x: note.x,
		y: note.y,
		width: note.width,
		height: note.height,
		color: note.color ?? undefined,
	}
}

export function noteFromStored(note: DiagramNote): NoteDraft {
	return {
		id: note.id,
		schemaName: note.schemaName,
		text: note.text,
		x: note.x,
		y: note.y,
		width: note.width,
		height: note.height,
		color: note.color,
		isTemp: false,
	}
}

export class DiagramSync {
	private saved: DiagramState = { positions: {}, notes: [] }
	// The id the store gave each note created on the canvas, by its temporary
	// id. The canvas keeps the temporary one, so the note's node is not
	// remounted (and its edit lost) when it is first saved.
	private readonly created = new Map<string, string>()

	constructor(
		private readonly store: DiagramStore,
		readonly schemaId: string,
	) {}

	/** What is stored now, as loaded or as last written. */
	reset(state: DiagramState) {
		this.saved = {
			positions: clonePositions(state.positions),
			notes: state.notes.map((note) => ({ ...note, id: this.idOf(note) })),
		}
	}

	hasChanges(state: DiagramState): boolean {
		return this.layoutChanged(state) || this.notesChanged(state)
	}

	/** Writes the differences; `state` should be a copy the canvas won't change. */
	async save(state: DiagramState): Promise<void> {
		if (this.layoutChanged(state)) {
			await this.store.saveLayout(
				this.schemaId,
				clonePositions(state.positions),
			)
		}
		await this.saveNotes(state)
		this.reset(state)
	}

	private idOf(note: NoteDraft): string {
		return this.created.get(note.id) ?? note.id
	}

	private layoutChanged(state: DiagramState): boolean {
		return (
			JSON.stringify(this.saved.positions) !== JSON.stringify(state.positions)
		)
	}

	private notesChanged(state: DiagramState): boolean {
		const saved = new Map(this.saved.notes.map((note) => [note.id, note]))
		return (
			saved.size !== state.notes.length ||
			state.notes.some((note) => {
				const before = saved.get(this.idOf(note))
				return !before || noteChanged(before, note)
			})
		)
	}

	private async saveNotes(state: DiagramState) {
		const saved = new Map(this.saved.notes.map((note) => [note.id, note]))
		const current = new Set(state.notes.map((note) => this.idOf(note)))
		for (const note of this.saved.notes) {
			if (!current.has(note.id)) await this.store.deleteNote(note.id)
		}
		for (const note of state.notes) {
			const id = this.idOf(note)
			const before = saved.get(id)
			if (!before) await this.createNote(note)
			else if (noteChanged(before, note))
				await this.store.updateNote(id, notePatch(note))
		}
	}

	private async createNote(note: NoteDraft) {
		const created = await this.store.createNote({
			schemaName: this.schemaId,
			text: note.text,
			x: note.x,
			y: note.y,
			width: note.width,
			height: note.height,
			color: note.color ?? undefined,
		})
		this.created.set(note.id, created.id)
		Object.assign(note, noteFromStored(created))
	}
}
