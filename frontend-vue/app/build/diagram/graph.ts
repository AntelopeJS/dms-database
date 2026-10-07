import dagre from '@dagrejs/dagre'
import { MarkerType } from '@vue-flow/core'
import type {
	SchemaSummary,
	TableSummary,
} from '../composables/useDatabaseSchemas'
import type { DiagramPositions } from '../composables/useDiagramPersistence'

// Turns a schema into the nodes and edges of the diagram: one node per table,
// a dashed stub for a table of another schema a relation points to, the
// notes, and one edge per relation column. Table positions come from the
// saved layout; a table without one is placed by dagre.

export const NODE_WIDTH = 232
const NODE_HEIGHT_PER_FIELD = 24
const NODE_HEIGHT_HEADER = 44
export const STUB_NODE_WIDTH = 180
const STUB_NODE_HEIGHT = 28
const LAYOUT = { rankdir: 'LR', nodesep: 48, ranksep: 120 } as const
const HYSTERESIS_PX = 15

export const TABLE_NODE_TYPE = 'tableNode'
export const STUB_NODE_TYPE = 'stubNode'
export const NOTE_NODE_TYPE = 'noteNode'
export const RELATION_EDGE_TYPE = 'relationEdge'

export interface NoteDraft {
	id: string
	schemaName: string
	text: string
	x: number
	y: number
	width: number
	height: number
	color: string | null
	/** Not stored yet: created on the canvas, waiting for its save. */
	isTemp: boolean
}

export interface TableNodeData {
	schemaId: string
	tableName: string
	table: TableSummary
	/** Columns of the selected table's relations, drawn highlighted. */
	highlighted: string[]
	dimmed: boolean
	/** Picked on the canvas, by a search or from a link. */
	selected: boolean
}

export interface NoteNodeData {
	noteId: string
	text: string
	width: number
	height: number
	onTextChange: (noteId: string, text: string) => void
	onDelete: (noteId: string) => void
}

export interface DiagramNode {
	id: string
	type: string
	position: { x: number; y: number }
	selectable?: boolean
	draggable?: boolean
	data: Record<string, unknown>
}

export interface EdgeEnds {
	sourceBase: string
	targetBase: string
	isStubTarget: boolean
	active: boolean
}

export interface DiagramEdge {
	id: string
	type: typeof RELATION_EDGE_TYPE
	source: string
	target: string
	sourceHandle: string
	targetHandle: string
	label: string
	animated: boolean
	markerEnd: { type: MarkerType }
	data: EdgeEnds
}

type HandleSide = 'left' | 'right'
export interface Sides {
	source: HandleSide
	target: HandleSide
}

export interface GraphInput {
	schema: SchemaSummary
	positions: DiagramPositions
	notes: NoteDraft[]
	/** Node id of the selected table: its edges and columns light up. */
	selectedId: string | null
	/** When set, only these tables are drawn (a table and its neighbours). */
	focusIds: Set<string> | null
	noteHandlers: Pick<NoteNodeData, 'onTextChange' | 'onDelete'>
	/** Opens the schema a stub belongs to. */
	onOpenSchema: (schemaId: string) => void
	/** Sides each edge used last, so an edge does not flip on every drag. */
	routing: Map<string, Sides>
}

export interface BuiltGraph {
	nodes: DiagramNode[]
	edges: DiagramEdge[]
}

export function tableNodeId(schemaId: string, tableName: string): string {
	return `${schemaId}::${tableName}`
}

function stubNodeId(schemaId: string, tableName: string): string {
	return `stub::${schemaId}::${tableName}`
}

function nodeHeight(table: TableSummary): number {
	return (
		NODE_HEIGHT_HEADER +
		Object.keys(table.fields).length * NODE_HEIGHT_PER_FIELD
	)
}

/** Ids of a table and of every table it points to or is pointed at from. */
export function neighbourIds(
	schema: SchemaSummary,
	tableName: string,
): Set<string> {
	const ids = new Set([tableNodeId(schema.id, tableName)])
	for (const table of schema.tables) {
		for (const relation of table.relations) {
			if (table.name === tableName)
				ids.add(tableNodeId(relation.toSchema, relation.toTable))
			if (relation.toSchema === schema.id && relation.toTable === tableName) {
				ids.add(tableNodeId(schema.id, table.name))
			}
		}
	}
	return ids
}

/**
 * Picks the handle sides of an edge from the horizontal distance between its
 * nodes, keeping the previous sides within a small margin.
 */
export function pickSides(dx: number, width: number, previous?: Sides): Sides {
	const pure: Sides =
		dx >= width
			? { source: 'right', target: 'left' }
			: dx >= 0
				? { source: 'right', target: 'right' }
				: dx >= -width
					? { source: 'left', target: 'left' }
					: { source: 'left', target: 'right' }
	if (!previous) return pure
	const keepRanges: Record<string, [number, number]> = {
		'right-left': [width - HYSTERESIS_PX, Infinity],
		'right-right': [-HYSTERESIS_PX, width + HYSTERESIS_PX],
		'left-left': [-width - HYSTERESIS_PX, HYSTERESIS_PX],
		'left-right': [-Infinity, -width + HYSTERESIS_PX],
	}
	const [min, max] = keepRanges[`${previous.source}-${previous.target}`] ?? [
		0, 0,
	]
	return dx > min && dx < max ? previous : pure
}

interface PendingEdge {
	id: string
	sourceId: string
	targetId: string
	ends: EdgeEnds
	label: string
	many: boolean
}

type DagreGraph = InstanceType<typeof dagre.graphlib.Graph>

/** A node as dagre lays it out: its centre and size. */
interface LaidNode {
	x: number
	y: number
	width: number
	height: number
}

interface StubTarget {
	schema: string
	table: string
}

interface Layout {
	graph: DagreGraph
	stubs: Map<string, StubTarget>
	pending: PendingEdge[]
}

function relationEdges(
	input: GraphInput,
	visible: Set<string>,
	graph: DagreGraph,
) {
	const stubs = new Map<string, StubTarget>()
	const pending: PendingEdge[] = []
	const { schema } = input
	for (const table of schema.tables) {
		const sourceId = tableNodeId(schema.id, table.name)
		if (!visible.has(sourceId)) continue
		for (const relation of table.relations) {
			const realTargetId = tableNodeId(relation.toSchema, relation.toTable)
			const isStubTarget = !visible.has(realTargetId)
			const targetId = isStubTarget
				? stubNodeId(relation.toSchema, relation.toTable)
				: realTargetId
			if (isStubTarget && !stubs.has(targetId)) {
				stubs.set(targetId, {
					schema: relation.toSchema,
					table: relation.toTable,
				})
				graph.setNode(targetId, {
					width: STUB_NODE_WIDTH,
					height: STUB_NODE_HEIGHT,
				})
			}
			graph.setEdge(sourceId, targetId)
			const target = schema.tables.find((t) => t.name === relation.toTable)
			pending.push({
				id: `${sourceId}::${relation.fromField}->${realTargetId}`,
				sourceId,
				targetId,
				label: relation.fromField,
				many: relation.many,
				ends: {
					sourceBase:
						relation.fromField in table.fields
							? relation.fromField
							: '__node__',
					targetBase: isStubTarget
						? 'stub'
						: target && relation.toField in target.fields
							? relation.toField
							: '__node__',
					isStubTarget,
					active:
						input.selectedId !== null &&
						(input.selectedId === sourceId ||
							input.selectedId === realTargetId),
				},
			})
		}
	}
	return { stubs, pending }
}

function layOut(input: GraphInput, visible: Set<string>): Layout {
	const graph = new dagre.graphlib.Graph()
	graph.setDefaultEdgeLabel(() => ({}))
	graph.setGraph({ ...LAYOUT })
	for (const table of input.schema.tables) {
		const id = tableNodeId(input.schema.id, table.name)
		if (visible.has(id))
			graph.setNode(id, { width: NODE_WIDTH, height: nodeHeight(table) })
	}
	const { stubs, pending } = relationEdges(input, visible, graph)
	dagre.layout(graph)
	return { graph, stubs, pending }
}

function highlightedColumns(input: GraphInput, table: TableSummary): string[] {
	const selected = input.selectedId
	if (!selected) return []
	const own = tableNodeId(input.schema.id, table.name)
	const columns = new Set<string>()
	for (const relation of table.relations) {
		const target = tableNodeId(relation.toSchema, relation.toTable)
		if (own === selected || target === selected) columns.add(relation.fromField)
	}
	for (const other of input.schema.tables) {
		for (const relation of other.relations) {
			const fromSelected = tableNodeId(input.schema.id, other.name) === selected
			if (fromSelected && relation.toTable === table.name)
				columns.add(relation.toField)
		}
	}
	return [...columns]
}

function tableNodes(
	input: GraphInput,
	layout: Layout,
	visible: Set<string>,
): DiagramNode[] {
	return input.schema.tables
		.filter((table) => visible.has(tableNodeId(input.schema.id, table.name)))
		.map((table) => {
			const id = tableNodeId(input.schema.id, table.name)
			const laid = layout.graph.node(id) as LaidNode
			const highlighted = highlightedColumns(input, table)
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
			}
			return {
				id,
				type: TABLE_NODE_TYPE,
				position: input.positions[table.name] ?? {
					x: laid.x - NODE_WIDTH / 2,
					y: laid.y - laid.height / 2,
				},
				data: data as unknown as Record<string, unknown>,
			}
		})
}

export interface StubNodeData {
	targetSchema: string
	targetTable: string
	onOpenSchema: (schemaId: string) => void
}

function stubNodes(input: GraphInput, layout: Layout): DiagramNode[] {
	return [...layout.stubs].map(([id, target]) => {
		const laid = layout.graph.node(id) as LaidNode
		return {
			id,
			type: STUB_NODE_TYPE,
			position: { x: laid.x - STUB_NODE_WIDTH / 2, y: laid.y },
			selectable: false,
			draggable: false,
			data: {
				targetSchema: target.schema,
				targetTable: target.table,
				onOpenSchema: input.onOpenSchema,
			} satisfies StubNodeData as unknown as Record<string, unknown>,
		}
	})
}

function noteNodes(input: GraphInput): DiagramNode[] {
	return input.notes.map((note) => {
		const data: NoteNodeData = {
			noteId: note.id,
			text: note.text,
			width: note.width,
			height: note.height,
			...input.noteHandlers,
		}
		return {
			id: `note::${note.id}`,
			type: NOTE_NODE_TYPE,
			position: { x: note.x, y: note.y },
			data: data as unknown as Record<string, unknown>,
		}
	})
}

function nodeWidth(node: DiagramNode): number {
	return node.type === STUB_NODE_TYPE ? STUB_NODE_WIDTH : NODE_WIDTH
}

function routeEdges(
	input: GraphInput,
	layout: Layout,
	nodes: DiagramNode[],
): DiagramEdge[] {
	const byId = new Map(nodes.map((node) => [node.id, node]))
	return layout.pending.flatMap((edge) => {
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
				markerEnd: { type: MarkerType.ArrowClosed },
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
	const layout = layOut(input, visible)
	const nodes = [
		...tableNodes(input, layout, visible),
		...stubNodes(input, layout),
		...noteNodes(input),
	]
	return { nodes, edges: routeEdges(input, layout, nodes) }
}

/** Positions dagre gives every table of the schema, ignoring the saved ones. */
export function autoLayoutPositions(schema: SchemaSummary): DiagramPositions {
	const built = buildGraph({
		schema,
		positions: {},
		notes: [],
		selectedId: null,
		focusIds: null,
		noteHandlers: { onTextChange: () => undefined, onDelete: () => undefined },
		onOpenSchema: () => undefined,
		routing: new Map(),
	})
	const positions: DiagramPositions = {}
	for (const node of built.nodes) {
		if (node.type !== TABLE_NODE_TYPE) continue
		positions[(node.data as unknown as TableNodeData).tableName] = {
			...node.position,
		}
	}
	return positions
}
