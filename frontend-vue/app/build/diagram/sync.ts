import type {
	DiagramNote,
	DiagramNoteCreate,
	DiagramNoteUpdate,
	DiagramPositions,
} from "../../composables/useDiagramPersistence";
import type { NoteDraft } from "./graph";
import { clonePositions, type DiagramState } from "./history";

// Saves the diagram as it changes (D-10): the layout and the notes are
// compared with what was last stored, and only the differences are written.

export interface DiagramStore {
	saveLayout(schema: string, positions: DiagramPositions): Promise<void>;
	createNote(payload: DiagramNoteCreate): Promise<DiagramNote>;
	updateNote(id: string, patch: DiagramNoteUpdate): Promise<DiagramNote>;
	deleteNote(id: string): Promise<void>;
}

/** Called when a note created on the canvas gets its stored id. */
export type NoteRenamed = (fromId: string, toId: string) => void;

const NOTE_FIELDS = ["text", "x", "y", "width", "height", "color"] as const;

function noteChanged(saved: NoteDraft, current: NoteDraft): boolean {
	return NOTE_FIELDS.some((field) => saved[field] !== current[field]);
}

function notePatch(note: NoteDraft): DiagramNoteUpdate {
	return {
		text: note.text,
		x: note.x,
		y: note.y,
		width: note.width,
		height: note.height,
		color: note.color ?? undefined,
	};
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
	};
}

export class DiagramSync {
	private saved: DiagramState = { positions: {}, notes: [] };

	constructor(
		private readonly store: DiagramStore,
		private readonly schemaId: string,
		private readonly onRenamed: NoteRenamed,
	) {}

	/** What is stored now, as loaded or as last written. */
	reset(state: DiagramState) {
		this.saved = {
			positions: clonePositions(state.positions),
			notes: state.notes.map((note) => ({ ...note })),
		};
	}

	hasChanges(state: DiagramState): boolean {
		return this.layoutChanged(state) || this.notesChanged(state);
	}

	async save(state: DiagramState): Promise<void> {
		if (this.layoutChanged(state)) {
			await this.store.saveLayout(this.schemaId, clonePositions(state.positions));
		}
		await this.saveNotes(state);
		this.reset(state);
	}

	private layoutChanged(state: DiagramState): boolean {
		return JSON.stringify(this.saved.positions) !== JSON.stringify(state.positions);
	}

	private notesChanged(state: DiagramState): boolean {
		const saved = new Map(this.saved.notes.map((note) => [note.id, note]));
		return (
			saved.size !== state.notes.length ||
			state.notes.some((note) => {
				const before = saved.get(note.id);
				return !before || noteChanged(before, note);
			})
		);
	}

	private async saveNotes(state: DiagramState) {
		const saved = new Map(this.saved.notes.map((note) => [note.id, note]));
		const current = new Set(state.notes.map((note) => note.id));
		for (const note of this.saved.notes) {
			if (!current.has(note.id)) await this.store.deleteNote(note.id);
		}
		for (const note of state.notes) {
			const before = saved.get(note.id);
			if (!before) await this.createNote(note);
			else if (noteChanged(before, note)) await this.store.updateNote(note.id, notePatch(note));
		}
	}

	private async createNote(note: NoteDraft) {
		const created = await this.store.createNote({
			schemaName: this.schemaId,
			...notePatch(note),
			text: note.text,
			x: note.x,
			y: note.y,
			width: note.width,
			height: note.height,
		});
		const previousId = note.id;
		Object.assign(note, noteFromStored(created));
		this.onRenamed(previousId, created.id);
	}
}
