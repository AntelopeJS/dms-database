import { MarkerType } from '@vue-flow/core'
import type {
	SchemaSummary,
	TableSummary,
} from '../composables/useDatabaseSchemas'
import type { DiagramPosition } from '../composables/useDiagramPersistence'
import { overlaps, type Rect } from './packing'
import {
	type BuiltGraph,
	EDGE_ACTIVE_COLOR,
	EDGE_COLOR,
	EDGE_MANY_COLOR,
	type DiagramEdge,
	type DiagramNode,
	type GraphInput,
	matchingColumns,
	NODE_WIDTH,
	NOTE_NODE_TYPE,
	NOTE_Z_INDEX,
	noteNodeId,
	type NoteNodeData,
	type PendingEdge,
	pickSides,
	RELATION_EDGE_TYPE,
	relationEdges,
	type SchemaLayout,
	shownColumns,
	STUB_NODE_TYPE,
	STUB_NODE_WIDTH,
	type StubNodeData,
	type StubTarget,
	tableNodeId,
	TABLE_NODE_TYPE,
	type TableNodeData,
} from './graphModel'
import { layOutSchema } from './layout'

// Turns a schema into the nodes and edges of the diagram: one node per table,
// a dashed stub for a table a relation points to that is not drawn, the
// notes, and one edge per relation column. Table positions come from the
// saved layout; a table without one takes the place the layout of the whole
// schema gives it, so it stays put when the canvas focuses on a few tables.
// That layout runs dagre on each group of related tables, then sets the
// groups and the tables on their own in rows shaped like the canvas.

export {
	EDGE_ACTIVE_COLOR,
	EDGE_COLOR,
	EDGE_MANY_COLOR,
	expandForSearch,
	FOLDED_COLUMNS,
	neighbourIds,
	NODE_WIDTH,
	nodeHeight,
	NOTE_NODE_TYPE,
	NOTE_Z_INDEX,
	noteNodeId,
	pickSides,
	RELATION_EDGE_TYPE,
	shownColumns,
	STUB_NODE_TYPE,
	STUB_NODE_WIDTH,
	TABLE_NODE_TYPE,
	tableNodeId,
} from './graphModel'
export type {
	BuiltGraph,
	DiagramEdge,
	DiagramNode,
	EdgeEnds,
	GraphInput,
	NoteDraft,
	NoteNodeData,
	OpenTable,
	SchemaLayout,
	ShownColumns,
	Sides,
	StubNodeData,
	TableNodeData,
} from './graphModel'
export { layOutSchema } from './layout'
export type { LayoutOptions } from './layout'

/**
 * The columns of `table` lit up by the selection: its relation columns when it
 * or the table they point to is selected, and the columns relations point at
 * when it or the table they come from is selected.
 */
function highlightedColumns(input: GraphInput, table: TableSummary): string[] {
	const selected = input.selectedId
	if (!selected) return []
	const { schema } = input
	const own = tableNodeId(schema.id, table.name)
	const columns = new Set<string>()
	for (const relation of table.relations) {
		const target = tableNodeId(relation.toSchema, relation.toTable)
		if (own === selected || target === selected) columns.add(relation.fromField)
	}
	for (const other of schema.tables) {
		const from = tableNodeId(schema.id, other.name)
		for (const relation of other.relations) {
			const pointsHere =
				relation.toSchema === schema.id && relation.toTable === table.name
			if (pointsHere && (from === selected || own === selected))
				columns.add(relation.toField)
		}
	}
	return [...columns]
}

function tablePosition(
	input: GraphInput,
	layout: SchemaLayout,
	tableName: string,
): DiagramPosition {
	return (
		input.positions[tableName] ?? layout.tables[tableName] ?? { x: 0, y: 0 }
	)
}

function tableNodes(
	input: GraphInput,
	layout: SchemaLayout,
	visible: Set<string>,
): DiagramNode[] {
	return input.schema.tables
		.filter((table) => visible.has(tableNodeId(input.schema.id, table.name)))
		.map((table) => {
			const id = tableNodeId(input.schema.id, table.name)
			const highlighted = highlightedColumns(input, table)
			const expanded = input.expanded?.has(table.name) ?? false
			const data: TableNodeData = {
				schemaId: input.schema.id,
				tableName: table.name,
				table,
				highlighted,
				selected: input.selectedId === id,
				// Tables unrelated to the selected one step back.
				dimmed:
					input.selectedId !== null &&
					input.selectedId !== id &&
					highlighted.length === 0,
				...shownColumns(input.schema, table, expanded),
				expanded,
				onToggleColumns: input.onToggleColumns ?? (() => undefined),
			}
			return {
				id,
				type: TABLE_NODE_TYPE,
				// An unfolded table runs over the tables below it: drawn above them.
				...(expanded ? { zIndex: 1 } : {}),
				position: { ...tablePosition(input, layout, table.name) },
				// The canvas keeps its own selection (`data.selected`), and a
				// table leaves the diagram only with its schema.
				selectable: false,
				deletable: false,
				data: data as unknown as Record<string, unknown>,
			}
		})
}

/**
 * A stub for a table of this schema left out by the focus sits where that
 * table is; one for another schema takes the place the layout gives it.
 */
function stubPosition(
	input: GraphInput,
	layout: SchemaLayout,
	id: string,
	target: StubTarget,
): DiagramPosition {
	if (target.schema === input.schema.id)
		return tablePosition(input, layout, target.table)
	return layout.stubs[id] ?? { x: 0, y: 0 }
}

function stubNodes(
	input: GraphInput,
	layout: SchemaLayout,
	stubs: Map<string, StubTarget>,
): DiagramNode[] {
	return [...stubs].map(([id, target]) => ({
		id,
		type: STUB_NODE_TYPE,
		position: { ...stubPosition(input, layout, id, target) },
		selectable: false,
		draggable: false,
		deletable: false,
		data: {
			targetSchema: target.schema,
			targetTable: target.table,
			onOpenSchema: input.onOpenSchema,
		} satisfies StubNodeData as unknown as Record<string, unknown>,
	}))
}

function noteNodes(input: GraphInput): DiagramNode[] {
	return input.notes.map((note) => {
		const data: NoteNodeData = {
			noteId: note.id,
			text: note.text,
			width: note.width,
			height: note.height,
			autoEdit: input.editNoteId === note.id,
			...input.noteHandlers,
		}
		return {
			id: noteNodeId(note.id),
			type: NOTE_NODE_TYPE,
			position: { x: note.x, y: note.y },
			zIndex: NOTE_Z_INDEX,
			data: data as unknown as Record<string, unknown>,
		}
	})
}

function nodeWidth(node: DiagramNode): number {
	return node.type === STUB_NODE_TYPE ? STUB_NODE_WIDTH : NODE_WIDTH
}

function edgeColor(edge: PendingEdge): string {
	if (edge.ends.active) return EDGE_ACTIVE_COLOR
	return edge.many ? EDGE_MANY_COLOR : EDGE_COLOR
}

function routeEdges(
	input: GraphInput,
	pending: PendingEdge[],
	nodes: DiagramNode[],
): DiagramEdge[] {
	const byId = new Map(nodes.map((node) => [node.id, node]))
	return pending.flatMap((edge) => {
		const source = byId.get(edge.sourceId)
		const target = byId.get(edge.targetId)
		if (!source || !target) return []
		const dx =
			target.position.x +
			nodeWidth(target) / 2 -
			(source.position.x + nodeWidth(source) / 2)
		const sides = pickSides(dx, NODE_WIDTH, input.routing.get(edge.id))
		input.routing.set(edge.id, sides)
		return [
			{
				id: edge.id,
				type: RELATION_EDGE_TYPE,
				source: edge.sourceId,
				target: edge.targetId,
				sourceHandle: `${edge.ends.sourceBase}::${sides.source}::source`,
				targetHandle: `${edge.ends.targetBase}::${sides.target}::target`,
				label: edge.label,
				animated: edge.many,
				markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(edge) },
				data: edge.ends,
			},
		]
	})
}

export function buildGraph(input: GraphInput): BuiltGraph {
	const visible = new Set(
		input.schema.tables
			.map((table) => tableNodeId(input.schema.id, table.name))
			.filter((id) => !input.focusIds || input.focusIds.has(id)),
	)
	const layout = input.layout ?? layOutSchema(input.schema)
	const { stubs, pending } = relationEdges(
		input.schema,
		input.selectedId,
		visible,
	)
	const nodes = [
		...tableNodes(input, layout, visible),
		...stubNodes(input, layout, stubs),
		...noteNodes(input),
	]
	return { nodes, edges: routeEdges(input, pending, nodes) }
}

/**
 * Tables a search finds: those whose name holds `needle`, then those with a
 * column whose name holds it, each once.
 */
export function searchTables(schema: SchemaSummary, needle: string): string[] {
	const text = needle.trim().toLowerCase()
	if (!text) return []
	const byName = schema.tables.filter((table) =>
		table.name.toLowerCase().includes(text),
	)
	const byColumn = schema.tables.filter(
		(table) =>
			!byName.includes(table) && matchingColumns(table, text).length > 0,
	)
	return [...byName, ...byColumn].map((table) => table.name)
}

const FREE_SPOT_STEP = 40
const FREE_SPOT_RINGS = 12
const FREE_SPOT_MARGIN = 16

/**
 * The spot nearest `wanted` where a box of `size` covers none of `taken`,
 * searched ring by ring around it; `wanted` itself when none is free.
 */
export function freeSpot(
	wanted: DiagramPosition,
	size: { width: number; height: number },
	taken: Rect[],
): DiagramPosition {
	const fits = (x: number, y: number) =>
		!taken.some((rect) => overlaps({ x, y, ...size }, rect, FREE_SPOT_MARGIN))
	for (let ring = 0; ring <= FREE_SPOT_RINGS; ring++) {
		const candidates: DiagramPosition[] = []
		for (let i = -ring; i <= ring; i++) {
			for (let j = -ring; j <= ring; j++) {
				if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue
				candidates.push({
					x: wanted.x + i * FREE_SPOT_STEP,
					y: wanted.y + j * FREE_SPOT_STEP,
				})
			}
		}
		candidates.sort(
			(a, b) =>
				Math.hypot(a.x - wanted.x, a.y - wanted.y) -
				Math.hypot(b.x - wanted.x, b.y - wanted.y),
		)
		const free = candidates.find((point) => fits(point.x, point.y))
		if (free) return free
	}
	return wanted
}
