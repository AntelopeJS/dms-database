import type { NodeDragEvent } from '@vue-flow/core'
import type { Ref } from 'vue'
import {
	type DiagramNode,
	NOTE_NODE_TYPE,
	TABLE_NODE_TYPE,
} from '../diagram/graph'
import type { DiagramOperation, DiagramState } from '../diagram/history'

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

	// With `select-nodes-on-drag` off, Vue Flow lets go of the selection when a
	// node not selected is grabbed, so a note left selected does not follow a
	// table, which Vue Flow cannot select.
	function onNodeDragStart({ node, nodes }: NodeDragEvent) {
		for (const dragged of nodes.length ? nodes : [node])
			dragStarts.set(dragged.id, { ...dragged.position })
	}

	function tableMoved(node: DiagramNode, from: { x: number; y: number }) {
		const tableName = (node.data as { tableName: string }).tableName
		const to = { x: node.position.x, y: node.position.y }
		state.positions[tableName] = to
		if (preview.value) return
		record({ kind: 'tableMove', tableName, from, to })
	}

	function noteMoved(node: DiagramNode, from: { x: number; y: number }) {
		const noteId = (node.data as { noteId: string }).noteId
		const to = { x: node.position.x, y: node.position.y }
		const note = state.notes.find((n) => n.id === noteId)
		if (!note) return
		Object.assign(note, to)
		record({ kind: 'noteMove', noteId, from, to })
	}

	const DRAG_HANDLERS: Record<
		string,
		(node: DiagramNode, from: { x: number; y: number }) => void
	> = {
		[TABLE_NODE_TYPE]: tableMoved,
		[NOTE_NODE_TYPE]: noteMoved,
	}

	function onNodeDragStop({ node, nodes }: NodeDragEvent) {
		for (const dragged of nodes.length ? nodes : [node]) {
			const from = dragStarts.get(dragged.id)
			dragStarts.delete(dragged.id)
			const { x, y } = dragged.position
			if (!from || (from.x === x && from.y === y)) continue
			DRAG_HANDLERS[dragged.type ?? '']?.(
				dragged as unknown as DiagramNode,
				from,
			)
		}
		// The node put down becomes the selection: a table through
		// `data.selected` (D-9), a note through Vue Flow. Set once the drag is
		// over, as setting the nodes during it would put the dragged one back.
		selectedId.value = node.type === TABLE_NODE_TYPE ? node.id : null
		if (node.type === NOTE_NODE_TYPE && !node.selected) selectNode(node.id)
		render()
	}

	return { onNodeDragStart, onNodeDragStop }
}
