import { describe, expect, it } from 'vitest'
import type { SchemaSummary } from '../app/build/composables/useDatabaseSchemas'
import {
	buildGraph,
	expandForSearch,
	FOLDED_COLUMNS,
	type GraphInput,
	layOutSchema,
	NODE_WIDTH,
	nodeHeight,
	type SchemaLayout,
	shownColumns,
	STUB_NODE_WIDTH,
	TABLE_NODE_TYPE,
	type TableNodeData,
	tableNodeId,
} from '../app/build/diagram/graph'
import {
	boundsOf,
	DEFAULT_ASPECT,
	fitZoom,
	linkedGroups,
	overlaps,
	PACK_GAP,
	packBlocks,
	type Rect,
	shelfRows,
	startViewport,
} from '../app/build/diagram/packing'

// A schema shaped like a real MongoDB one: about forty tables on their own,
// most named `<module>_<table>`, a few groups linked by relations, a
// relation to another schema, and one very tall table (60 columns) whose
// relation column and the column pointed at sit far below the fold.

type Relation = {
	fromField: string
	toSchema: string
	toTable: string
	toField: string
	many: boolean
}

function table(name: string, columns: number, relations: Relation[] = []) {
	const fields: Record<string, { kind: string }> = { _id: { kind: 'string' } }
	for (let i = 1; i < columns; i++) fields[`field_${i}`] = { kind: 'string' }
	for (const relation of relations)
		fields[relation.fromField] = { kind: 'string' }
	return { name, fields, indexes: {}, relations }
}

function to(fromField: string, toTable: string, toField = '_id'): Relation {
	return { fromField, toSchema: 'app', toTable, toField, many: false }
}

const ISOLATED = [
	...Array.from({ length: 12 }, (_, i) =>
		table(`dms-core_t${String(i).padStart(2, '0')}`, 3 + (i % 6)),
	),
	...Array.from({ length: 10 }, (_, i) =>
		table(`dms-tenant_t${String(i).padStart(2, '0')}`, 4 + (i % 5)),
	),
	...Array.from({ length: 8 }, (_, i) =>
		table(`dms-files_t${String(i).padStart(2, '0')}`, 2 + (i % 7)),
	),
	...Array.from({ length: 10 }, (_, i) =>
		table(`plain_${String(i).padStart(2, '0')}`, 5 + (i % 4)),
	),
]

// audit (60 columns) -> users by `user_id`, its 46th column; sessions point
// at audit's `code`, its 31st column.
const audit = table('dms-core_audit', 60)
audit.fields.user_id = { kind: 'string' }
audit.relations = [to('user_id', 'dms-core_users')]

const APP = {
	id: 'app',
	tables: [
		...ISOLATED,
		audit,
		table('dms-core_users', 6),
		table('dms-core_sessions', 4, [
			to('audit_code', 'dms-core_audit', 'field_30'),
		]),
		table('shop_orders', 5, [to('customer_id', 'shop_customers')]),
		table('shop_customers', 4),
		table('shop_items', 4, [
			to('order_id', 'shop_orders'),
			to('product_id', 'shop_products'),
		]),
		table('shop_products', 6),
		table('blog_posts', 5, [to('author_id', 'blog_authors')]),
		table('blog_authors', 3),
		table('invoices', 4, [
			{
				fromField: 'account_id',
				toSchema: 'billing',
				toTable: 'accounts',
				toField: '_id',
				many: false,
			},
		]),
	],
} as unknown as SchemaSummary

const tableOf = (name: string) =>
	APP.tables.find((t) => t.name === name) as SchemaSummary['tables'][number]

function rects(schema: SchemaSummary, layout: SchemaLayout): Map<string, Rect> {
	const out = new Map<string, Rect>()
	for (const t of schema.tables) {
		const at = layout.tables[t.name] as { x: number; y: number }
		out.set(t.name, {
			...at,
			width: NODE_WIDTH,
			height: nodeHeight(schema, t),
		})
	}
	for (const [id, at] of Object.entries(layout.stubs))
		out.set(id, { ...at, width: STUB_NODE_WIDTH, height: 28 })
	return out
}

function input(overrides: Partial<GraphInput> = {}): GraphInput {
	return {
		schema: APP,
		positions: {},
		notes: [],
		selectedId: null,
		focusIds: null,
		noteHandlers: {
			onTextChange: () => undefined,
			onDelete: () => undefined,
			onEditEnd: () => undefined,
		},
		onOpenSchema: () => undefined,
		routing: new Map(),
		...overrides,
	}
}

const GROUPS = {
	core: ['dms-core_audit', 'dms-core_users', 'dms-core_sessions'],
	shop: ['shop_orders', 'shop_customers', 'shop_items', 'shop_products'],
	blog: ['blog_posts', 'blog_authors'],
}

describe('diagram layout', () => {
	const layout = layOutSchema(APP)
	const placed = rects(APP, layout)

	it('lays out no table or stub over another', () => {
		const all = [...placed]
		for (let i = 0; i < all.length; i++) {
			for (let j = i + 1; j < all.length; j++) {
				const [a, ra] = all[i] as [string, Rect]
				const [b, rb] = all[j] as [string, Rect]
				expect(overlaps(ra, rb), `${a} / ${b}`).toBe(false)
			}
		}
	})

	it('fills a canvas shaped like a wide screen, not a column', () => {
		const bounds = boundsOf([...placed.values()])
		const ratio = bounds.width / bounds.height
		expect(ratio).toBeGreaterThan(DEFAULT_ASPECT / 1.5)
		expect(ratio).toBeLessThan(DEFAULT_ASPECT * 1.5)
		// A square canvas gets a squarer layout.
		const square = boundsOf([
			...rects(APP, layOutSchema(APP, { aspect: 1 })).values(),
		])
		expect(square.width / square.height).toBeLessThan(ratio)
		expect(square.width / square.height).toBeGreaterThan(1 / 1.5)
	})

	it('keeps linked tables together, with no other table among them', () => {
		for (const [name, members] of Object.entries(GROUPS)) {
			const box = boundsOf(members.map((m) => placed.get(m) as Rect))
			for (const [other, rect] of placed) {
				if (members.includes(other) || other.startsWith('stub::')) continue
				expect(overlaps(box, rect), `${name} / ${other}`).toBe(false)
			}
		}
		// The stub of another schema sits next to the table it hangs from.
		const stub = placed.get('stub::billing::accounts') as Rect
		const invoices = placed.get('invoices') as Rect
		expect(Math.abs(stub.x - invoices.x)).toBeLessThan(NODE_WIDTH + 200)
		expect(Math.abs(stub.y - invoices.y)).toBeLessThan(200)
	})

	it('runs dagre left to right within a group', () => {
		const items = placed.get('shop_items') as Rect
		const orders = placed.get('shop_orders') as Rect
		const customers = placed.get('shop_customers') as Rect
		expect(items.x).toBeLessThan(orders.x)
		expect(orders.x).toBeLessThan(customers.x)
	})

	it('places the groups first, then the tables on their own by name', () => {
		// Rows are bands no table crosses: merge the tables' heights.
		const bands: [number, number][] = []
		for (const rect of [...placed.values()].sort((a, b) => a.y - b.y)) {
			const last = bands.at(-1)
			if (last && rect.y <= last[1])
				last[1] = Math.max(last[1], rect.y + rect.height)
			else bands.push([rect.y, rect.y + rect.height])
		}
		expect(bands.length).toBeGreaterThan(1)
		const rowOf = (name: string) => {
			const { y } = placed.get(name) as Rect
			return bands.findIndex(([top, bottom]) => y >= top && y <= bottom)
		}
		const linked = Object.values(GROUPS).flat()
		const lastGroupRow = Math.max(...linked.map(rowOf))
		const order = ISOLATED.map((t) => t.name).sort((a, b) => a.localeCompare(b))
		// Rows follow the order: a table never sits on a row above one before it.
		for (let i = 1; i < order.length; i++)
			expect(rowOf(order[i] as string)).toBeGreaterThanOrEqual(
				rowOf(order[i - 1] as string),
			)
		// Tables on their own start on or after the groups' first row.
		expect(rowOf(order[0] as string)).toBeGreaterThanOrEqual(
			Math.min(...linked.map(rowOf)),
		)
		expect(lastGroupRow).toBeLessThanOrEqual(rowOf(order.at(-1) as string))
	})

	it('keeps clear of the notes', () => {
		const note = { x: 300, y: 0, width: 220, height: 140 }
		const around = rects(APP, layOutSchema(APP, { obstacles: [note] }))
		for (const [name, rect] of around)
			expect(overlaps(rect, note), name).toBe(false)
	})

	it('groups linked ids in their order', () => {
		expect(
			linkedGroups(
				['a', 'b', 'c', 'd', 'e'],
				[
					['a', 'c'],
					['d', 'c'],
				],
			),
		).toEqual([['a', 'c', 'd'], ['b'], ['e']])
	})

	it('packs one block per row when the rows can hold no more', () => {
		const packed = packBlocks(
			[
				{ id: 'a', width: 100, height: 400 },
				{ id: 'b', width: 100, height: 400 },
			],
			0.1,
		)
		expect(packed.get('a')?.x).toBe(packed.get('b')?.x)
	})

	it('puts the tallest block of a row first and stacks short ones beside it', () => {
		const blocks = [
			{ id: 'short1', width: 100, height: 100 },
			{ id: 'tall', width: 300, height: 600 },
			{ id: 'short2', width: 100, height: 100 },
			{ id: 'short3', width: 100, height: 100 },
		]
		expect(shelfRows(blocks, 600)).toEqual([blocks])
		const packed = packBlocks(blocks, 1)
		expect(packed.get('tall')).toEqual({ x: 0, y: 0 })
		// The short ones share one column, in their order, under each other.
		const xs = new Set(
			['short1', 'short2', 'short3'].map((id) => packed.get(id)?.x),
		)
		expect(xs.size).toBe(1)
		expect(packed.get('short1')?.y).toBe(0)
		expect(packed.get('short2')?.y).toBe(100 + PACK_GAP)
		expect(packed.get('short3')?.y).toBe(2 * (100 + PACK_GAP))
	})
})

describe('folded tables', () => {
	it('shows the first columns and every column an arrow ends on', () => {
		const shown = shownColumns(APP, tableOf('dms-core_audit'), false)
		expect(shown.foldable).toBe(true)
		expect(shown.columns.slice(0, FOLDED_COLUMNS)).toEqual(
			Object.keys(tableOf('dms-core_audit').fields).slice(0, FOLDED_COLUMNS),
		)
		// Its key, its relation column, and the column sessions point at.
		expect(shown.columns).toContain('_id')
		expect(shown.columns).toContain('user_id')
		expect(shown.columns).toContain('field_30')
		expect(shown.columns).toHaveLength(FOLDED_COLUMNS + 2)
		expect(shown.hiddenCount).toBe(61 - FOLDED_COLUMNS - 2)
		const open = shownColumns(APP, tableOf('dms-core_audit'), true)
		expect(open.columns).toHaveLength(61)
		expect(open.hiddenCount).toBe(0)
	})

	it('leaves small tables as they are, with no fold row', () => {
		const shown = shownColumns(APP, tableOf('shop_orders'), false)
		expect(shown).toMatchObject({ foldable: false, hiddenCount: 0 })
		expect(nodeHeight(APP, tableOf('shop_orders'))).toBe(44 + 6 * 24)
	})

	it('lays out at the folded height', () => {
		const audit = tableOf('dms-core_audit')
		expect(nodeHeight(APP, audit)).toBe(44 + (FOLDED_COLUMNS + 2 + 1) * 24)
		expect(nodeHeight(APP, audit, true)).toBe(44 + (61 + 1) * 24)
	})

	it('never ends an arrow on a row that is not drawn', () => {
		const graph = buildGraph(input())
		const columns = new Map(
			graph.nodes
				.filter((n) => n.type === TABLE_NODE_TYPE)
				.map((n) => [n.id, (n.data as unknown as TableNodeData).columns]),
		)
		for (const edge of graph.edges) {
			const source = edge.sourceHandle.split('::')[0] as string
			const target = edge.targetHandle.split('::')[0] as string
			expect(columns.get(edge.source)).toContain(source)
			if (!edge.data.isStubTarget)
				expect(columns.get(edge.target)).toContain(target)
		}
	})

	it('draws an expanded table whole, above the others', () => {
		const graph = buildGraph(input({ expanded: new Set(['dms-core_audit']) }))
		const node = graph.nodes.find(
			(n) => n.id === tableNodeId('app', 'dms-core_audit'),
		)
		const data = node?.data as unknown as TableNodeData
		expect(data.columns).toHaveLength(61)
		expect(data).toMatchObject({ expanded: true, hiddenCount: 0 })
		expect(node?.zIndex).toBe(1)
	})

	it('unfolds the table a search finds a folded column in', () => {
		const none = new Set<string>()
		const audit = 'dms-core_audit'
		expect(expandForSearch(APP, audit, 'field_40', none)).toEqual(
			new Set([audit]),
		)
		// A column already drawn, or a match on the name only, leaves it folded.
		expect(expandForSearch(APP, audit, 'field_11', none)).toBe(none)
		expect(expandForSearch(APP, audit, 'audit', none)).toBe(none)
		expect(expandForSearch(APP, audit, 'user_id', none)).toBe(none)
	})
})

describe('start view', () => {
	const size = { width: 1600, height: 900 }

	it('fits the diagram when it reads at 40% or closer', () => {
		const bounds = { x: 0, y: 0, width: 2000, height: 1000 }
		expect(fitZoom(bounds, size, 0.25)).toBeCloseTo(0.64)
		expect(startViewport(bounds, 0.64, 0.4, { x: 32, y: 80 })).toBeNull()
	})

	it('starts at 40% on the top-left corner of a larger one', () => {
		const bounds = { x: -100, y: 50, width: 12000, height: 6000 }
		const zoom = fitZoom(bounds, size, 0.25)
		expect(zoom).toBeLessThan(0.4)
		expect(startViewport(bounds, zoom, 0.4, { x: 32, y: 80 })).toEqual({
			x: 32 + 100 * 0.4,
			y: 80 - 50 * 0.4,
			zoom: 0.4,
		})
	})

	it('reads the example schema at 40% or closer on a wide screen', () => {
		const bounds = boundsOf([...rects(APP, layOutSchema(APP)).values()])
		// The layout before this change: one column about as tall as the
		// schema's tables stacked.
		expect(fitZoom(bounds, size, 0.25)).toBeGreaterThan(0.2)
	})
})
