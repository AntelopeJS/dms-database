import type { VueFlowStore } from '@vue-flow/core'
import type { ComputedRef, Ref, ShallowRef, ShallowUnwrapRef } from 'vue'
import {
	freeSpot,
	NODE_WIDTH,
	nodeHeight,
	type NoteDraft,
	noteNodeId,
	TABLE_NODE_TYPE,
	type TableNodeData,
} from '../diagram/graph'
import type { DiagramOperation, DiagramState } from '../diagram/history'
import type { Rect } from '../diagram/packing'
import type { SchemaSummary } from './useDatabaseSchemas'

const NOTE_WIDTH = 220
const NOTE_HEIGHT = 140

/** What the notes read and write of the diagram page. */
interface NotesContext {
	state: DiagramState
	canvas: ShallowRef<ShallowUnwrapRef<VueFlowStore> | null>
	canvasWrapper: Readonly<ShallowRef<HTMLElement | null>>
	schema: ComputedRef<SchemaSummary | null>
	schemaId: ComputedRef<string | null>
	viewport: Ref<{ x: number; y: number; zoom: number }>
	selectedId: Ref<string | null>
	editNoteId: Ref<string | null>
	record: (op: DiagramOperation) => void
	render: () => void
}

/** The notes of the diagram: added, written, moved, deleted, with undo. */
export function useDiagramNotes({
	state,
	canvas,
	canvasWrapper,
	schema,
	schemaId,
	viewport,
	selectedId,
	editNoteId,
	record,
	render,
}: NotesContext) {
	// What a new note should not cover: the tables drawn, and every note. Sizes
	// come from the schema and the notes, as a node just added is not measured.
	function takenRects(): Rect[] {
		const tables = (canvas.value?.getNodes ?? []).flatMap((node) => {
			if (node.type !== TABLE_NODE_TYPE) return []
			const { table, expanded: open } = node.data as TableNodeData
			if (!schema.value) return []
			return [
				{
					x: node.position.x,
					y: node.position.y,
					width: NODE_WIDTH,
					height: nodeHeight(schema.value, table, open),
				},
			]
		})
		return [...tables, ...state.notes]
	}

	function selectNode(nodeId: string) {
		const flow = canvas.value
		const node = flow?.findNode(nodeId)
		if (!flow || !node) return
		flow.removeSelectedNodes(flow.getSelectedNodes)
		flow.addSelectedNodes([node])
	}

	// A new note goes in the free space nearest the centre of the view, above
	// the tables, selected and ready to write (D-8).
	function addNote() {
		if (!schemaId.value) return
		const rect = canvasWrapper.value?.getBoundingClientRect()
		const { x, y, zoom } = viewport.value
		const centre = {
			x: ((rect?.width ?? 800) / 2 - x) / zoom - NOTE_WIDTH / 2,
			y: ((rect?.height ?? 600) / 2 - y) / zoom - NOTE_HEIGHT / 2,
		}
		const spot = freeSpot(
			centre,
			{ width: NOTE_WIDTH, height: NOTE_HEIGHT },
			takenRects(),
		)
		const note: NoteDraft = {
			id: `temp-${Date.now()}`,
			schemaName: schemaId.value,
			text: '',
			x: Math.round(spot.x),
			y: Math.round(spot.y),
			width: NOTE_WIDTH,
			height: NOTE_HEIGHT,
			color: null,
			isTemp: true,
		}
		state.notes.push(note)
		record({ kind: 'noteCreate', snapshot: { ...note } })
		editNoteId.value = note.id
		selectedId.value = null
		render()
		nextTick(() => selectNode(noteNodeId(note.id)))
	}

	function changeNoteText(noteId: string, text: string) {
		const note = state.notes.find((n) => n.id === noteId)
		if (!note || note.text === text) return
		record({ kind: 'noteText', noteId, from: note.text, to: text })
		note.text = text
		render()
	}

	function endNoteEdit(noteId: string) {
		if (editNoteId.value !== noteId) return
		editNoteId.value = null
		render()
	}

	function deleteNote(noteId: string) {
		const note = state.notes.find((n) => n.id === noteId)
		if (!note) return
		state.notes = state.notes.filter((n) => n.id !== noteId)
		if (editNoteId.value === noteId) editNoteId.value = null
		record({ kind: 'noteDelete', snapshot: { ...note } })
		render()
	}

	// Delete or Backspace on the canvas: only notes go, with undo (D-3).
	function onDeleteNodes(ids: string[]) {
		const doomed = new Set(ids)
		for (const note of [...state.notes]) {
			if (doomed.has(noteNodeId(note.id))) deleteNote(note.id)
		}
	}

	return {
		addNote,
		changeNoteText,
		deleteNote,
		endNoteEdit,
		onDeleteNodes,
		selectNode,
	}
}
