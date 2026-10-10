import dagre from '@dagrejs/dagre'
import { MarkerType } from '@vue-flow/core'
import type {
	SchemaSummary,
	TableSummary,
} from '../composables/useDatabaseSchemas'
import type {
	DiagramPosition,
	DiagramPositions,
} from '../composables/useDiagramPersistence'

// Turns a schema into the nodes and edges of the diagram: one node per table,
// a dashed stub for a table a relation points to that is not drawn, the
// notes, and one edge per relation column. Table positions come from the
// saved layout; a table without one takes the place dagre gives it in the
// whole schema, so it stays put when the canvas focuses on a few tables.

export const NODE_WIDTH = 232
const NODE_HEIGHT_PER_FIELD = 24
const NODE_HEIGHT_HEADER = 44
export const STUB_NODE_WIDTH = 180
const STUB_NODE_HEIGHT = 28
const LAYOUT = { rankdir: 'LR', nodesep: 48, ranksep: 120 } as const
const HYSTERESIS_PX = 15
// Notes sit above the tables, so a new one is never hidden under a table.
export const NOTE_Z_INDEX = 10
// Arrow colours, as theme tokens so they follow the light and dark themes.
export const EDGE_COLOR = 'var(--ui-border-accented)'
export const EDGE_MANY_COLOR = 'var(--color-dms-500)'
export const EDGE_ACTIVE_COLOR = 'var(--ui-primary)'

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
	/** Opens the note in edit mode when it mounts: a note just created. */
	autoEdit: boolean
	onTextChange: (noteId: string, text: string) => void
	onDelete: (noteId: string) => void
	/** The note left edit mode, changed or not. */
	onEditEnd: (noteId: string) => void
}

export interface DiagramNode {
	id: string
	type: string
	position: { x: number; y: number }
	selectable?: boolean
	draggable?: boolean
	deletable?: boolean
	zIndex?: number
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
	markerEnd: { type: MarkerType; color: string }
	data: EdgeEnds
}

type HandleSide = 'left' | 'right'
export interface Sides {
	source: HandleSide
	target: HandleSide
}

/** Opens a table, in its own schema's diagram when it belongs to another. */
export type OpenTable = (schemaId: string, tableName: string) => void

/** Where dagre puts each table of a schema, and each stub of another one. */
export interface SchemaLayout {
	tables: DiagramPositions
	/** Keyed by stub node id. */
	stubs: DiagramPositions
}

export interface GraphInput {
	schema: SchemaSummary
	positions: DiagramPositions
	notes: NoteDraft[]
	/** Node id of the selected table: its edges and columns light up. */
	selectedId: string | null
	/** When set, only these tables are drawn (a table and its neighbours). */
	focusIds: Set<string> | null
	noteHandlers: Pick<NoteNodeData, 'onTextChange' | 'onDelete' | 'onEditEnd'>
	/** The note to open in edit mode: the one just created. */
	editNoteId?: string | null
	/** Opens the table a stub stands for. */
	onOpenSchema: OpenTable
	/** Sides each edge used last, so an edge does not flip on every drag. */
	routing: Map<string, Sides>
	/**
	 * Where dagre puts every table of the whole schema; computed when absent.
	 * The canvas keeps it per schema, so a render does not lay out again.
	 */
	layout?: SchemaLayout
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

export function noteNodeId(noteId: string): string {
	return `note::${noteId}`
}

export function nodeHeight(table: TableSummary): number {
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

interface Relations {
	stubs: Map<string, StubTarget>
	pending: PendingEdge[]
}

function relationEdges(
	schema: SchemaSummary,
	selectedId: string | null,
	visible: Set<string>,
): Relations {
	const stubs = new Map<string, StubTarget>()
	const pending: PendingEdge[] = []
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
			}
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
						selectedId !== null &&
						(selectedId === sourceId || selectedId === realTargetId),
				},
			})
		}
	}
	return { stubs, pending }
}

/**
 * Lays out the whole schema with dagre: every table, and a stub for each
 * table of another schema a relation points to.
 */
export function layOutSchema(schema: SchemaSummary): SchemaLayout {
	const graph = new dagre.graphlib.Graph()
	graph.setDefaultEdgeLabel(() => ({}))
	graph.setGraph({ ...LAYOUT })
	const all = new Set<string>()
	for (const table of schema.tables) {
		const id = tableNodeId(schema.id, table.name)
		all.add(id)
		graph.setNode(id, { width: NODE_WIDTH, height: nodeHeight(table) })
	}
	const { stubs, pending } = relationEdges(schema, null, all)
	for (const id of stubs.keys())
		graph.setNode(id, { width: STUB_NODE_WIDTH, height: STUB_NODE_HEIGHT })
	for (const edge of pending) graph.setEdge(edge.sourceId, edge.targetId)
	dagre.layout(graph)
	const topLeft = (id: string): DiagramPosition => {
		const laid = graph.node(id) as LaidNode
		return { x: laid.x - laid.width / 2, y: laid.y - laid.height / 2 }
	}
	const tables: DiagramPositions = {}
	for (const table of schema.tables)
		tables[table.name] = topLeft(tableNodeId(schema.id, table.name))
	const stubPositions: DiagramPositions = {}
	for (const id of stubs.keys()) stubPositions[id] = topLeft(id)
	return { tables, stubs: stubPositions }
}

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
				position: { ...tablePosition(input, layout, table.name) },
				// The canvas keeps its own selection (`data.selected`), and a
				// table leaves the diagram only with its schema.
				selectable: false,
				deletable: false,
				data: data as unknown as Record<string, unknown>,
			}
		})
}

export interface StubNodeData {
	targetSchema: string
	targetTable: string
	onOpenSchema: OpenTable
}

/**
 * A stub for a table of this schema left out by the focus sits where that
 * table is; one for another schema takes the place dagre gives it.
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
			!byName.includes(table) &&
			Object.keys(table.fields).some((field) =>
				field.toLowerCase().includes(text),
			),
	)
	return [...byName, ...byColumn].map((table) => table.name)
}

export interface Rect {
	x: number
	y: number
	width: number
	height: number
}

function overlaps(a: Rect, b: Rect, margin: number): boolean {
	return (
		a.x < b.x + b.width + margin &&
		b.x < a.x + a.width + margin &&
		a.y < b.y + b.height + margin &&
		b.y < a.y + a.height + margin
	)
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
