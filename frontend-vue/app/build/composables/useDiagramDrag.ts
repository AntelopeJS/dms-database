import type { NodeDragEvent } from '@vue-flow/core'
import type { Ref } from 'vue'
import {
	type DiagramNode,
	NOTE_NODE_TYPE,
	TABLE_NODE_TYPE,
	type NoteNodeData,
	type TableNodeData,
} from '../diagram/graph'
import type { DiagramOperation, DiagramState } from '../diagram/history'

type DraggedNode = Pick<DiagramNode, 'position' | 'data'>

/** Whether node data carries the name of the table it draws. */
function isTableDragData(
	data: unknown,
): data is Pick<TableNodeData, 'tableName'> {
	return (
		typeof data === 'object' &&
		data !== null &&
		'tableName' in data &&
		typeof data.tableName === 'string'
	)
}

/** Whether node data carries the id of the note it draws. */
function isNoteDragData(data: unknown): data is Pick<NoteNodeData, 'noteId'> {
	return (
		typeof data === 'object' &&
		data !== null &&
		'noteId' in data &&
		typeof data.noteId === 'string'
	)
}

/** What dragging reads and writes of the diagram page. */
interface DragContext {
	state: DiagramState
	preview: Readonly<Ref<object | null>>
	selectedId: Ref<string | null>
	record: (op: DiagramOperation) => void
	render: () => void
	selectNode: (nodeId: string) => void
}

/** Moving tables and notes on the canvas: each move is recorded for undo. */
export function useDiagramDrag({
	state,
	preview,
	selectedId,
	record,
	render,
	selectNode,
}: DragContext) {
	const dragStarts = new Map<string, { x: number; y: number }>()

	function onNodeDragStart({ node, nodes }: NodeDragEvent) {
		for (const dragged of nodes.length ? nodes : [node])
			dragStarts.set(dragged.id, { ...dragged.position })
	}

	function tableMoved(node: DraggedNode, from: { x: number; y: number }) {
		if (!isTableDragData(node.data)) return
		const { tableName } = node.data
		const to = { x: node.position.x, y: node.position.y }
		state.positions[tableName] = to
		if (preview.value) return
		record({ kind: 'tableMove', tableName, from, to })
	}

	function noteMoved(node: DraggedNode, from: { x: number; y: number }) {
		if (!isNoteDragData(node.data)) return
		const { noteId } = node.data
		const to = { x: node.position.x, y: node.position.y }
		const note = state.notes.find((n) => n.id === noteId)
		if (!note) return
		Object.assign(note, to)
		record({ kind: 'noteMove', noteId, from, to })
	}

	function onNodeDragStop({ node, nodes }: NodeDragEvent) {
		for (const dragged of nodes.length ? nodes : [node]) {
			const from = dragStarts.get(dragged.id)
			dragStarts.delete(dragged.id)
			const { x, y } = dragged.position
			if (!from || (from.x === x && from.y === y)) continue
			if (dragged.type === TABLE_NODE_TYPE) tableMoved(dragged, from)
			else if (dragged.type === NOTE_NODE_TYPE) noteMoved(dragged, from)
		}
		selectedId.value = node.type === TABLE_NODE_TYPE ? node.id : null
		if (node.type === NOTE_NODE_TYPE && !node.selected) selectNode(node.id)
		render()
	}

	return { onNodeDragStart, onNodeDragStop }
}
