import { MarkerType } from '@vue-flow/core'
import type {
	SchemaSummary,
	TableSummary,
} from '../composables/useDatabaseSchemas'
import type { DiagramPositions } from '../composables/useDiagramPersistence'
import { isPrimaryKey } from '../utils/fieldTypes'

export const NODE_WIDTH = 232
const NODE_HEIGHT_PER_FIELD = 24
const NODE_HEIGHT_HEADER = 44
export const STUB_NODE_WIDTH = 180
export const STUB_NODE_HEIGHT = 28
export const LAYOUT = { rankdir: 'LR', nodesep: 48, ranksep: 120 } as const
/** Columns a folded table shows, besides the ones an arrow ends on. */
export const FOLDED_COLUMNS = 12
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
	/** The columns drawn, in the table's order: all of them when unfolded. */
	columns: string[]
	/** Columns the folded table leaves out; 0 when it shows them all. */
	hiddenCount: number
	/** Has more columns than a folded table shows. */
	foldable: boolean
	expanded: boolean
	onToggleColumns: (tableName: string) => void
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

export type HandleSide = 'left' | 'right'
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
	 * Where the layout puts every table of the whole schema; computed when
	 * absent. The canvas keeps it per schema, so a render does not lay out
	 * again.
	 */
	layout?: SchemaLayout
	/** Tables showing all their columns; the others are folded. */
	expanded?: Set<string>
	onToggleColumns?: (tableName: string) => void
}

export interface BuiltGraph {
	nodes: DiagramNode[]
	edges: DiagramEdge[]
}

export function tableNodeId(schemaId: string, tableName: string): string {
	return `${schemaId}::${tableName}`
}

export function stubNodeId(schemaId: string, tableName: string): string {
	return `stub::${schemaId}::${tableName}`
}

export function noteNodeId(noteId: string): string {
	return `note::${noteId}`
}

/**
 * Columns of `table` an arrow ends on: its primary key, its relation
 * columns, and the columns relations of `schema` point at.
 */
function anchorColumns(
	schema: SchemaSummary,
	table: TableSummary,
): Set<string> {
	const anchors = new Set(table.relations.map((r) => r.fromField))
	for (const field of Object.keys(table.fields))
		if (isPrimaryKey(field, table.indexes ?? {})) anchors.add(field)
	for (const other of schema.tables) {
		for (const relation of other.relations) {
			if (relation.toSchema === schema.id && relation.toTable === table.name)
				anchors.add(relation.toField)
		}
	}
	return anchors
}

export interface ShownColumns {
	columns: string[]
	hiddenCount: number
	foldable: boolean
}

/**
 * The columns a table node draws: every one when expanded; folded, the first
 * FOLDED_COLUMNS and every column an arrow ends on, so no edge points to a
 * row that is not drawn.
 */
export function shownColumns(
	schema: SchemaSummary,
	table: TableSummary,
	expanded: boolean,
): ShownColumns {
	const all = Object.keys(table.fields)
	const foldable = all.length > FOLDED_COLUMNS
	if (!foldable || expanded) return { columns: all, hiddenCount: 0, foldable }
	const anchors = anchorColumns(schema, table)
	const columns = all.filter(
		(name, i) => i < FOLDED_COLUMNS || anchors.has(name),
	)
	return { columns, hiddenCount: all.length - columns.length, foldable }
}

/**
 * The height of a table node: its header, its rows, and the row that folds
 * or unfolds it when it has one.
 */
export function nodeHeight(
	schema: SchemaSummary,
	table: TableSummary,
	expanded = false,
): number {
	const shown = shownColumns(schema, table, expanded)
	const rows = shown.columns.length + (shown.foldable ? 1 : 0)
	return NODE_HEIGHT_HEADER + rows * NODE_HEIGHT_PER_FIELD
}

/** Column names of `table` that hold `needle`, as the search reads it. */
export function matchingColumns(table: TableSummary, needle: string): string[] {
	const text = needle.trim().toLowerCase()
	if (!text) return []
	return Object.keys(table.fields).filter((field) =>
		field.toLowerCase().includes(text),
	)
}

/**
 * The expanded tables once a search lands on `tableName`: it unfolds when a
 * column the search finds is folded away.
 */
export function expandForSearch(
	schema: SchemaSummary,
	tableName: string,
	needle: string,
	expanded: Set<string>,
): Set<string> {
	const table = schema.tables.find((t) => t.name === tableName)
	if (!table || expanded.has(tableName)) return expanded
	const shown = new Set(shownColumns(schema, table, false).columns)
	const folded = matchingColumns(table, needle).some((c) => !shown.has(c))
	return folded ? new Set([...expanded, tableName]) : expanded
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

export interface PendingEdge {
	id: string
	sourceId: string
	targetId: string
	ends: EdgeEnds
	label: string
	many: boolean
}

export interface StubTarget {
	schema: string
	table: string
}

export interface Relations {
	stubs: Map<string, StubTarget>
	pending: PendingEdge[]
}

export function relationEdges(
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

export interface StubNodeData {
	targetSchema: string
	targetTable: string
	onOpenSchema: OpenTable
}
