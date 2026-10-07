import type { DiagramPositions } from '../composables/useDiagramPersistence'
import type { NoteDraft } from './graph'

// The diagram's undo stack. Every change is an operation that knows how to
// apply itself and how to take itself back; the canvas saves whatever state
// results, so undo and redo are saved like any other change.

interface Point {
	x: number
	y: number
}

export type DiagramOperation =
	| { kind: 'tableMove'; tableName: string; from: Point; to: Point }
	| { kind: 'noteMove'; noteId: string; from: Point; to: Point }
	| { kind: 'noteText'; noteId: string; from: string; to: string }
	| { kind: 'noteCreate'; snapshot: NoteDraft }
	| { kind: 'noteDelete'; snapshot: NoteDraft }
	| { kind: 'layout'; from: DiagramPositions; to: DiagramPositions }

export interface DiagramState {
	positions: DiagramPositions
	notes: NoteDraft[]
}

type OperationOf<K extends DiagramOperation['kind']> = Extract<
	DiagramOperation,
	{ kind: K }
>
type Apply<K extends DiagramOperation['kind']> = (
	state: DiagramState,
	op: OperationOf<K>,
) => void
interface Handlers<K extends DiagramOperation['kind']> {
	forward: Apply<K>
	reverse: Apply<K>
}
type OperationHandlers = { [K in DiagramOperation['kind']]: Handlers<K> }

// Moves and text edits made in quick succession are one step.
const SQUASH_WINDOW_MS = 600

export function clonePositions(positions: DiagramPositions): DiagramPositions {
	return Object.fromEntries(
		Object.entries(positions).map(([name, point]) => [
			name,
			{ x: point.x, y: point.y },
		]),
	)
}

function findNote(state: DiagramState, noteId: string): NoteDraft | undefined {
	return state.notes.find((note) => note.id === noteId)
}

function moveNote(state: DiagramState, noteId: string, point: Point) {
	const note = findNote(state, noteId)
	if (note) Object.assign(note, { x: point.x, y: point.y })
}

function setNoteText(state: DiagramState, noteId: string, text: string) {
	const note = findNote(state, noteId)
	if (note) note.text = text
}

function addNote(state: DiagramState, snapshot: NoteDraft) {
	if (!findNote(state, snapshot.id)) state.notes.push({ ...snapshot })
}

function removeNote(state: DiagramState, noteId: string) {
	const index = state.notes.findIndex((note) => note.id === noteId)
	if (index >= 0) state.notes.splice(index, 1)
}

const HANDLERS: OperationHandlers = {
	tableMove: {
		forward: (state, op) => (state.positions[op.tableName] = { ...op.to }),
		reverse: (state, op) => (state.positions[op.tableName] = { ...op.from }),
	},
	noteMove: {
		forward: (state, op) => moveNote(state, op.noteId, op.to),
		reverse: (state, op) => moveNote(state, op.noteId, op.from),
	},
	noteText: {
		forward: (state, op) => setNoteText(state, op.noteId, op.to),
		reverse: (state, op) => setNoteText(state, op.noteId, op.from),
	},
	noteCreate: {
		forward: (state, op) => addNote(state, op.snapshot),
		reverse: (state, op) => removeNote(state, op.snapshot.id),
	},
	noteDelete: {
		forward: (state, op) => removeNote(state, op.snapshot.id),
		reverse: (state, op) => addNote(state, op.snapshot),
	},
	layout: {
		forward: (state, op) => (state.positions = clonePositions(op.to)),
		reverse: (state, op) => (state.positions = clonePositions(op.from)),
	},
}

function run(
	state: DiagramState,
	op: DiagramOperation,
	direction: keyof Handlers<never>,
) {
	const handlers = HANDLERS[op.kind] as Handlers<typeof op.kind>
	;(handlers[direction] as (s: DiagramState, o: DiagramOperation) => void)(
		state,
		op,
	)
}

/** Folds `next` into `head` when both edit the same thing in a burst. */
function squash(head: DiagramOperation, next: DiagramOperation): boolean {
	if (head.kind !== next.kind) return false
	if (
		next.kind === 'tableMove' &&
		head.kind === 'tableMove' &&
		head.tableName === next.tableName
	) {
		head.to = next.to
		return true
	}
	if (
		(next.kind === 'noteMove' || next.kind === 'noteText') &&
		(head.kind === 'noteMove' || head.kind === 'noteText') &&
		head.noteId === next.noteId
	) {
		head.to = next.to as never
		return true
	}
	return false
}

export class DiagramHistory {
	private operations: DiagramOperation[] = []
	private cursor = 0
	private lastPushAt = 0

	get canUndo(): boolean {
		return this.cursor > 0
	}

	get canRedo(): boolean {
		return this.cursor < this.operations.length
	}

	clear() {
		this.operations = []
		this.cursor = 0
	}

	/** Records an operation already applied to the state. */
	push(op: DiagramOperation, now = Date.now()) {
		this.operations.splice(this.cursor)
		const head = this.operations[this.cursor - 1]
		const recent = now - this.lastPushAt < SQUASH_WINDOW_MS
		this.lastPushAt = now
		if (head && recent && squash(head, op)) return
		this.operations.push(op)
		this.cursor += 1
	}

	undo(state: DiagramState): boolean {
		if (!this.canUndo) return false
		this.cursor -= 1
		run(state, this.operations[this.cursor] as DiagramOperation, 'reverse')
		return true
	}

	redo(state: DiagramState): boolean {
		if (!this.canRedo) return false
		run(state, this.operations[this.cursor] as DiagramOperation, 'forward')
		this.cursor += 1
		return true
	}

	/** Swaps a note's temporary id for the id its save gave it. */
	renameNote(fromId: string, toId: string) {
		for (const op of this.operations) {
			if ('noteId' in op && op.noteId === fromId) op.noteId = toId
			if ('snapshot' in op && op.snapshot.id === fromId) op.snapshot.id = toId
		}
	}
}
