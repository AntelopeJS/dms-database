import dagre from '@dagrejs/dagre'
import type {
	DiagramPosition,
	DiagramPositions,
} from '../composables/useDiagramPersistence'
import type { SchemaSummary } from '../composables/useDatabaseSchemas'
import {
	type Block,
	boundsOf,
	DEFAULT_ASPECT,
	linkedGroups,
	packBlocks,
	prefixOrder,
	type Rect,
	type Size,
} from './packing'
import {
	LAYOUT,
	NODE_WIDTH,
	nodeHeight,
	relationEdges,
	type SchemaLayout,
	STUB_NODE_HEIGHT,
	STUB_NODE_WIDTH,
	tableNodeId,
} from './graphModel'

/** A node as dagre lays it out: its centre and size. */
interface LaidNode {
	x: number
	y: number
	width: number
	height: number
}

export interface LayoutOptions {
	/** Width / height of the canvas: the shape the rows aim at. */
	aspect?: number
	/** What the tables must not cover: the notes, which never move. */
	obstacles?: Rect[]
}

interface LaidGroup extends Size {
	/** Each node's top-left corner, from the group's own. */
	offsets: Map<string, DiagramPosition>
}

/** Lays out one group of related nodes with dagre. */
function layOutGroup(
	ids: string[],
	sizes: Map<string, Size>,
	links: [string, string][],
): LaidGroup {
	const graph = new dagre.graphlib.Graph()
	graph.setDefaultEdgeLabel(() => ({}))
	graph.setGraph({ ...LAYOUT })
	const members = new Set(ids)
	for (const id of ids) graph.setNode(id, { ...sizes.get(id) })
	for (const [from, to] of links)
		if (members.has(from) && members.has(to)) graph.setEdge(from, to)
	dagre.layout(graph)
	const rects = ids.map((id) => {
		const laid = graph.node(id) as LaidNode
		const x = laid.x - laid.width / 2
		const y = laid.y - laid.height / 2
		return { id, x, y, width: laid.width, height: laid.height }
	})
	const bounds = boundsOf(rects)
	const offsets = new Map(
		rects.map((r) => [r.id, { x: r.x - bounds.x, y: r.y - bounds.y }]),
	)
	return { offsets, width: bounds.width, height: bounds.height }
}

/**
 * Lays out the whole schema, every table and a stub for each table of
 * another schema a relation points to: dagre on each group of tables linked
 * by relations, a stub staying with the tables it hangs from, then the
 * groups, largest first, and the tables on their own, by name prefix then
 * name, in rows shaped like the canvas. Tables count at their folded height.
 */
export function layOutSchema(
	schema: SchemaSummary,
	options: LayoutOptions = {},
): SchemaLayout {
	const sizes = new Map<string, Size>()
	const names = new Map<string, string>()
	for (const table of schema.tables) {
		const id = tableNodeId(schema.id, table.name)
		names.set(id, table.name)
		sizes.set(id, { width: NODE_WIDTH, height: nodeHeight(schema, table) })
	}
	const { stubs, pending } = relationEdges(schema, null, new Set(names.keys()))
	for (const id of stubs.keys())
		sizes.set(id, { width: STUB_NODE_WIDTH, height: STUB_NODE_HEIGHT })
	const links = pending.map((e): [string, string] => [e.sourceId, e.targetId])

	const groups: (Block & LaidGroup & { count: number })[] = []
	const alone: string[] = []
	for (const ids of linkedGroups([...sizes.keys()], links)) {
		const [first = ''] = ids
		if (ids.length === 1 && names.has(first)) {
			alone.push(names.get(first) ?? first)
			continue
		}
		const laid = layOutGroup(ids, sizes, links)
		groups.push({ id: `group::${first}`, count: ids.length, ...laid })
	}
	groups.sort(
		(a, b) => b.count - a.count || b.width * b.height - a.width * a.height,
	)
	const single: Block[] = prefixOrder(alone).map((name) => {
		const id = tableNodeId(schema.id, name)
		return { id, ...(sizes.get(id) as Size) }
	})

	const packed = packBlocks(
		[...groups, ...single],
		options.aspect ?? DEFAULT_ASPECT,
		options.obstacles,
	)
	const positions = new Map(packed)
	for (const group of groups) {
		const at = packed.get(group.id) ?? { x: 0, y: 0 }
		for (const [id, offset] of group.offsets)
			positions.set(id, { x: at.x + offset.x, y: at.y + offset.y })
	}
	const tables: DiagramPositions = {}
	for (const [id, name] of names)
		tables[name] = positions.get(id) ?? { x: 0, y: 0 }
	const stubPositions: DiagramPositions = {}
	for (const id of stubs.keys())
		stubPositions[id] = positions.get(id) ?? { x: 0, y: 0 }
	return { tables, stubs: stubPositions }
}
