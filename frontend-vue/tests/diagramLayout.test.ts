import { describe, expect, it } from 'vitest'
import { present } from './fixtures/present'
import { tableView } from './fixtures/diagramNodes'
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

type Table = SchemaSummary['tables'][number]
type Relation = Table['relations'][number]

function table(
	name: string,
	columns: number,
	relations: Relation[] = [],
): Table {
	const names = [
		'_id',
		...Array.from({ length: columns - 1 }, (_, i) => `field_${i + 1}`),
		...relations.map((relation) => relation.fromField),
	]
	const fields = Object.fromEntries(
		names.map((field) => [field, { kind: 'string' as const }]),
	)
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

const audit = table('dms-core_audit', 60)
audit.fields.user_id = { kind: 'string' }
audit.relations = [to('user_id', 'dms-core_users')]

const APP: SchemaSummary = {
	id: 'app',
	options: {},
	stats: { tableCount: 0, elementCount: 0, instanceCount: 0 },
	instances: [],
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
}

const tableOf = (name: string) =>
	present(
		APP.tables.find((t) => t.name === name),
		`the table ${name}`,
	)

const rectOf = (placed: Map<string, Rect>, name: string) =>
	present(placed.get(name), `the rectangle of ${name}`)

function rects(schema: SchemaSummary, layout: SchemaLayout): Map<string, Rect> {
	const out = new Map<string, Rect>()
	for (const t of schema.tables) {
		const at = present(layout.tables[t.name], `the position of ${t.name}`)
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
				const [a, ra] = present(all[i], 'a placed rectangle')
				const [b, rb] = present(all[j], 'a placed rectangle')
				expect(overlaps(ra, rb), `${a} / ${b}`).toBe(false)
			}
		}
	})

	it('fills a canvas shaped like a wide screen, not a column', () => {
		const bounds = boundsOf([...placed.values()])
		const ratio = bounds.width / bounds.height
		expect(ratio).toBeGreaterThan(DEFAULT_ASPECT / 1.5)
		expect(ratio).toBeLessThan(DEFAULT_ASPECT * 1.5)
		const square = boundsOf([
			...rects(APP, layOutSchema(APP, { aspect: 1 })).values(),
		])
		expect(square.width / square.height).toBeLessThan(ratio)
		expect(square.width / square.height).toBeGreaterThan(1 / 1.5)
	})

	it('keeps linked tables together, with no other table among them', () => {
		for (const [name, members] of Object.entries(GROUPS)) {
			const box = boundsOf(members.map((m) => rectOf(placed, m)))
			for (const [other, rect] of placed) {
				if (members.includes(other) || other.startsWith('stub::')) continue
				expect(overlaps(box, rect), `${name} / ${other}`).toBe(false)
			}
		}
		const stub = rectOf(placed, 'stub::billing::accounts')
		const invoices = rectOf(placed, 'invoices')
		expect(Math.abs(stub.x - invoices.x)).toBeLessThan(NODE_WIDTH + 200)
		expect(Math.abs(stub.y - invoices.y)).toBeLessThan(200)
	})

	it('runs dagre left to right within a group', () => {
		const items = rectOf(placed, 'shop_items')
		const orders = rectOf(placed, 'shop_orders')
		const customers = rectOf(placed, 'shop_customers')
		expect(items.x).toBeLessThan(orders.x)
		expect(orders.x).toBeLessThan(customers.x)
	})

	it('places the groups first, then the tables on their own by name', () => {
		const bands: [number, number][] = []
		for (const rect of [...placed.values()].sort((a, b) => a.y - b.y)) {
			const last = bands.at(-1)
			if (last && rect.y <= last[1])
				last[1] = Math.max(last[1], rect.y + rect.height)
			else bands.push([rect.y, rect.y + rect.height])
		}
		expect(bands.length).toBeGreaterThan(1)
		const rowOf = (name: string) => {
			const { y } = rectOf(placed, name)
			return bands.findIndex(([top, bottom]) => y >= top && y <= bottom)
		}
		const linked = Object.values(GROUPS).flat()
		const lastGroupRow = Math.max(...linked.map(rowOf))
		const order = ISOLATED.map((t) => t.name).sort((a, b) => a.localeCompare(b))
		for (let i = 1; i < order.length; i++)
			expect(rowOf(present(order[i], 'a table name'))).toBeGreaterThanOrEqual(
				rowOf(present(order[i - 1], 'a table name')),
			)
		expect(rowOf(present(order[0], 'a table name'))).toBeGreaterThanOrEqual(
			Math.min(...linked.map(rowOf)),
		)
		expect(lastGroupRow).toBeLessThanOrEqual(
			rowOf(present(order.at(-1), 'a table name')),
		)
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
				.map((n) => [n.id, tableView(n).columns]),
		)
		for (const edge of graph.edges) {
			const source = present(
				edge.sourceHandle.split('::')[0],
				'the source column',
			)
			const target = present(
				edge.targetHandle.split('::')[0],
				'the target column',
			)
			expect(columns.get(edge.source)).toContain(source)
			if (!edge.data.isStubTarget)
				expect(columns.get(edge.target)).toContain(target)
		}
	})

	it('ends an arrow on the table when its column is named like an Object member and absent', () => {
		const relation = (fromField: string, toField: string) => ({
			fromField,
			toSchema: 'quirks',
			toTable: 'teams',
			toField,
			many: false,
		})
		const schema: SchemaSummary = {
			...APP,
			id: 'quirks',
			tables: [
				{
					name: 'members',
					fields: { _id: { kind: 'string' }, team: { kind: 'string' } },
					indexes: {},
					relations: [
						relation('team', 'constructor'),
						relation('toString', '_id'),
					],
				},
				{
					name: 'teams',
					fields: { _id: { kind: 'string' } },
					indexes: {},
					relations: [],
				},
			],
		}
		const graph = buildGraph(input({ schema }))
		expect(
			graph.edges.map((edge) => [
				edge.sourceHandle.split('::')[0],
				edge.targetHandle.split('::')[0],
			]),
		).toEqual([
			['team', '__node__'],
			['__node__', '_id'],
		])
	})

	it('draws an expanded table whole, above the others', () => {
		const graph = buildGraph(input({ expanded: new Set(['dms-core_audit']) }))
		const node = graph.nodes.find(
			(n) => n.id === tableNodeId('app', 'dms-core_audit'),
		)
		const data = tableView(node)
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
		expect(fitZoom(bounds, size, 0.25)).toBeGreaterThan(0.2)
	})
})
