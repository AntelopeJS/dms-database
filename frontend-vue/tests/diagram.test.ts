import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SchemaSummary } from '../app/build/composables/useDatabaseSchemas'
import {
	DiagramAutosave,
	type SaveOwner,
	type SaveStatus,
} from '../app/build/diagram/autosave'
import {
	buildGraph,
	EDGE_ACTIVE_COLOR,
	EDGE_COLOR,
	freeSpot,
	type GraphInput,
	layOutSchema,
	neighbourIds,
	NOTE_Z_INDEX,
	type NoteDraft,
	searchTables,
	TABLE_NODE_TYPE,
	type TableNodeData,
	tableNodeId,
} from '../app/build/diagram/graph'
import { DiagramHistory, type DiagramState } from '../app/build/diagram/history'
import { nodesToRelease, pressedNodeId } from '../app/build/diagram/grab'
import { canvasOwnsKey, diagramCommand } from '../app/build/diagram/shortcuts'
import { DiagramSync, type DiagramStore } from '../app/build/diagram/sync'

// shop: order_items -> orders -> customers, order_items -> products, and
// orders -> billing.accounts in another schema.
const SHOP = {
	id: 'shop',
	tables: [
		{
			name: 'customers',
			fields: { _id: { kind: 'string' }, name: { kind: 'string' } },
			indexes: {},
			relations: [],
		},
		{
			name: 'products',
			fields: { _id: { kind: 'string' }, tags: { kind: 'array' } },
			indexes: {},
			relations: [],
		},
		{
			name: 'orders',
			fields: {
				_id: { kind: 'string' },
				customer_id: { kind: 'string' },
				account_id: { kind: 'string' },
			},
			indexes: {},
			relations: [
				{
					fromField: 'customer_id',
					toSchema: 'shop',
					toTable: 'customers',
					toField: '_id',
					many: false,
				},
				{
					fromField: 'account_id',
					toSchema: 'billing',
					toTable: 'accounts',
					toField: '_id',
					many: false,
				},
			],
		},
		{
			name: 'order_items',
			fields: {
				_id: { kind: 'string' },
				order_id: { kind: 'string' },
				product_id: { kind: 'string' },
			},
			indexes: {},
			relations: [
				{
					fromField: 'order_id',
					toSchema: 'shop',
					toTable: 'orders',
					toField: '_id',
					many: false,
				},
				{
					fromField: 'product_id',
					toSchema: 'shop',
					toTable: 'products',
					toField: '_id',
					many: true,
				},
			],
		},
	],
} as unknown as SchemaSummary

function input(overrides: Partial<GraphInput> = {}): GraphInput {
	return {
		schema: SHOP,
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

function tableData(graph: ReturnType<typeof buildGraph>, name: string) {
	const node = graph.nodes.find((n) => n.id === tableNodeId('shop', name))
	return node?.data as unknown as TableNodeData
}

function positionOf(graph: ReturnType<typeof buildGraph>, id: string) {
	return graph.nodes.find((n) => n.id === id)?.position
}

describe('diagram graph', () => {
	it('keeps an unsaved table where the whole schema puts it, focused or not (D-4)', () => {
		const layout = layOutSchema(SHOP)
		const full = buildGraph(input({ layout }))
		const focused = buildGraph(
			input({ layout, focusIds: neighbourIds(SHOP, 'orders') }),
		)
		for (const name of ['orders', 'customers', 'order_items']) {
			const id = tableNodeId('shop', name)
			expect(positionOf(focused, id)).toEqual(positionOf(full, id))
			expect(positionOf(full, id)).toEqual(layout.tables[name])
		}
		// Without a cached layout the result is the same.
		expect(buildGraph(input()).nodes.map((n) => n.position)).toEqual(
			full.nodes.map((n) => n.position),
		)
	})

	it('draws a stub where the table the focus leaves out is (D-10)', () => {
		const layout = layOutSchema(SHOP)
		const focused = buildGraph(
			input({ layout, focusIds: neighbourIds(SHOP, 'customers') }),
		)
		// customers -> orders is drawn; orders -> billing.accounts is a stub of
		// another schema; order_items is not a neighbour of customers.
		const stub = focused.nodes.find((n) => n.id === 'stub::billing::accounts')
		expect(stub?.data).toMatchObject({
			targetSchema: 'billing',
			targetTable: 'accounts',
		})
		const productsStub = buildGraph(
			input({ layout, focusIds: neighbourIds(SHOP, 'order_items') }),
		)
		const sameSchema = productsStub.nodes.find(
			(n) => n.id === 'stub::shop::customers',
		)
		expect(sameSchema?.position).toEqual(layout.tables.customers)
	})

	it('opens a stub on its table, in its schema', () => {
		const onOpenSchema = vi.fn()
		const graph = buildGraph(input({ onOpenSchema }))
		const stub = graph.nodes.find((n) => n.id === 'stub::billing::accounts')
		;(stub?.data.onOpenSchema as (s: string, t: string) => void)(
			'billing',
			'accounts',
		)
		expect(onOpenSchema).toHaveBeenCalledWith('billing', 'accounts')
	})

	it('keeps tables and stubs out of the canvas selection and deletion (D-3, D-9)', () => {
		const graph = buildGraph(input())
		for (const node of graph.nodes) {
			expect(node.deletable).toBe(false)
			expect(node.selectable).toBe(false)
		}
	})

	it('puts notes above the tables and opens the new one for writing (D-8)', () => {
		const note: NoteDraft = {
			id: 'temp-1',
			schemaName: 'shop',
			text: '',
			x: 0,
			y: 0,
			width: 220,
			height: 140,
			color: null,
			isTemp: true,
		}
		const graph = buildGraph(
			input({ notes: [note, { ...note, id: 'n2' }], editNoteId: 'temp-1' }),
		)
		const notes = graph.nodes.filter((n) => n.id.startsWith('note::'))
		expect(notes.map((n) => n.zIndex)).toEqual([NOTE_Z_INDEX, NOTE_Z_INDEX])
		expect(notes.map((n) => n.data.autoEdit)).toEqual([true, false])
	})

	it('lights up the column a relation points at when its table is selected (D-19)', () => {
		const graph = buildGraph(
			input({ selectedId: tableNodeId('shop', 'customers') }),
		)
		expect(tableData(graph, 'customers').highlighted).toEqual(['_id'])
		expect(tableData(graph, 'orders').highlighted).toEqual(['customer_id'])
		expect(tableData(graph, 'products').dimmed).toBe(true)
		const fromOrders = buildGraph(
			input({ selectedId: tableNodeId('shop', 'orders') }),
		)
		expect(tableData(fromOrders, 'customers').highlighted).toEqual(['_id'])
		expect(tableData(fromOrders, 'orders').highlighted.sort()).toEqual([
			'_id',
			'account_id',
			'customer_id',
		])
	})

	it('colours arrows with theme tokens, the active ones in primary (D-1)', () => {
		const graph = buildGraph(
			input({ selectedId: tableNodeId('shop', 'customers') }),
		)
		const colour = (id: string) =>
			graph.edges.find((e) => e.id.startsWith(id))?.markerEnd.color
		expect(colour('shop::orders::customer_id')).toBe(EDGE_ACTIVE_COLOR)
		expect(colour('shop::order_items::order_id')).toBe(EDGE_COLOR)
		for (const edge of graph.edges)
			expect(edge.markerEnd.color).toMatch(/^var\(--/)
	})

	it('only draws the table nodes it is asked for', () => {
		const graph = buildGraph(
			input({ focusIds: new Set([tableNodeId('shop', 'products')]) }),
		)
		expect(
			graph.nodes.filter((n) => n.type === TABLE_NODE_TYPE).map((n) => n.id),
		).toEqual([tableNodeId('shop', 'products')])
	})
})

describe('diagram search (D-13)', () => {
	it('finds tables by name first, then by column, each once', () => {
		expect(searchTables(SHOP, 'order')).toEqual(['orders', 'order_items'])
		expect(searchTables(SHOP, 'CUSTOMER')).toEqual(['customers', 'orders'])
		expect(searchTables(SHOP, 'tags')).toEqual(['products'])
		expect(searchTables(SHOP, '  ')).toEqual([])
		expect(searchTables(SHOP, 'nothing')).toEqual([])
	})
})

describe('note placement (D-8)', () => {
	it('keeps the wanted spot when it is free', () => {
		expect(freeSpot({ x: 0, y: 0 }, { width: 100, height: 100 }, [])).toEqual({
			x: 0,
			y: 0,
		})
	})

	it('moves off a table to the nearest free spot', () => {
		const table = { x: 0, y: 0, width: 200, height: 200 }
		const spot = freeSpot({ x: 50, y: 50 }, { width: 100, height: 100 }, [
			table,
		])
		const overlaps =
			spot.x < table.x + table.width &&
			table.x < spot.x + 100 &&
			spot.y < table.y + table.height &&
			table.y < spot.y + 100
		expect(overlaps).toBe(false)
	})
})

describe('diagram shortcuts (D-5, D-6)', () => {
	const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
		diagramCommand({
			key: k,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			...mods,
		})

	it('reads letters whatever their case', () => {
		expect(key('f')).toBe('search')
		expect(key('F')).toBe('search')
		expect(key('N', { shiftKey: true })).toBe('note')
		expect(key('V')).toBe('select')
		expect(key('H')).toBe('pan')
		expect(key('Escape')).toBe('escape')
		expect(key('x')).toBeNull()
		expect(key('f', { altKey: true })).toBeNull()
	})

	it('undoes with Ctrl+Z and redoes with Ctrl+Shift+Z or Ctrl+Y', () => {
		expect(key('z', { ctrlKey: true })).toBe('undo')
		expect(key('Z', { ctrlKey: true, shiftKey: true })).toBe('redo')
		expect(key('Z', { metaKey: true, shiftKey: true })).toBe('redo')
		expect(key('y', { ctrlKey: true })).toBe('redo')
		expect(key('f', { ctrlKey: true })).toBeNull()
	})

	function element(
		matches: Record<string, boolean>,
		page = false,
	): Element & { ownerDocument: unknown } {
		const doc = { body: null as unknown, documentElement: null }
		const el = {
			closest: (selector: string) =>
				Object.entries(matches).some(
					([part, hit]) => hit && selector.includes(part),
				)
					? el
					: null,
			ownerDocument: doc,
		}
		if (page) doc.body = el
		return el as unknown as Element & { ownerDocument: unknown }
	}

	it('leaves keys to fields, dialogs and the rest of the page', () => {
		const inside = element({})
		const canvas = { contains: (e: unknown) => e === inside } as Element
		expect(canvasOwnsKey(inside, canvas)).toBe(true)
		expect(canvasOwnsKey(element({}, true), canvas)).toBe(true)
		expect(canvasOwnsKey(element({ textarea: true }), canvas)).toBe(false)
		expect(canvasOwnsKey(element({ dialog: true }), canvas)).toBe(false)
		expect(canvasOwnsKey(element({}), canvas)).toBe(false)
	})
})

function memoryStore() {
	const calls: string[] = []
	let next = 0
	const store: DiagramStore = {
		saveLayout: async (schema, positions) => {
			calls.push(`layout ${schema} ${Object.keys(positions).join(',')}`)
		},
		createNote: async (payload) => {
			next += 1
			calls.push(`create ${payload.schemaName} ${payload.text}`)
			return {
				...payload,
				id: `n${next}`,
				color: payload.color ?? null,
				createdAt: '',
				updatedAt: '',
			}
		},
		updateNote: async (id, patch) => {
			calls.push(`update ${id} ${patch.text}`)
			return {} as never
		},
		deleteNote: async (id) => {
			calls.push(`delete ${id}`)
		},
	}
	return { store, calls }
}

function note(id: string, text: string, schemaName = 'a'): NoteDraft {
	return {
		id,
		schemaName,
		text,
		x: 0,
		y: 0,
		width: 220,
		height: 140,
		color: null,
		isTemp: id.startsWith('temp'),
	}
}

describe('diagram autosave (D-2)', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('writes a pending save under its own schema when another one is scheduled', async () => {
		vi.useFakeTimers()
		const { store, calls } = memoryStore()
		const statuses: [string, SaveStatus][] = []
		const autosave = new DiagramAutosave(800, (owner, status) =>
			statuses.push([owner.schemaId, status]),
		)
		const a = new DiagramSync(store, 'a')
		const b = new DiagramSync(store, 'b')
		// a: one table moved, one note written; then b is loaded right away.
		const stateA: DiagramState = {
			positions: { t: { x: 1, y: 2 } },
			notes: [note('temp-1', 'hello')],
		}
		const frozen = structuredClone(stateA)
		autosave.schedule(a, () => frozen)
		// b's state replaces a's on the page, and b's first edit comes in.
		const stateB: DiagramState = { positions: { u: { x: 0, y: 0 } }, notes: [] }
		autosave.schedule(b, () => stateB)
		await vi.runAllTimersAsync()
		expect(calls).toEqual(['layout a t', 'create a hello', 'layout b u'])
		expect(statuses).toEqual([
			['a', 'saving'],
			['a', 'saved'],
			['b', 'saving'],
			['b', 'saved'],
		])
	})

	it('waits for the delay, and writes nothing for an owner no longer shown', async () => {
		vi.useFakeTimers()
		const { store, calls } = memoryStore()
		const autosave = new DiagramAutosave(800, () => undefined)
		const a = new DiagramSync(store, 'a')
		let shown: DiagramSync | null = a
		const state: DiagramState = { positions: { t: { x: 1, y: 1 } }, notes: [] }
		autosave.schedule(a, () => (shown === a ? state : null))
		await vi.advanceTimersByTimeAsync(500)
		expect(calls).toEqual([])
		expect(autosave.busy).toBe(true)
		shown = null
		await vi.advanceTimersByTimeAsync(500)
		expect(calls).toEqual([])
		expect(autosave.busy).toBe(false)
	})

	it('reports a failed save and writes it again on retry', async () => {
		const { store, calls } = memoryStore()
		let fail = true
		const failing: DiagramStore = {
			...store,
			saveLayout: async (schema, positions) => {
				if (fail) throw new Error('timeout')
				await store.saveLayout(schema, positions)
			},
		}
		const statuses: SaveStatus[] = []
		const autosave = new DiagramAutosave(0, (_owner, status) =>
			statuses.push(status),
		)
		const a: SaveOwner = new DiagramSync(failing, 'a')
		const state: DiagramState = { positions: { t: { x: 1, y: 1 } }, notes: [] }
		autosave.schedule(a, () => state)
		await autosave.flush()
		expect(statuses).toEqual(['saving', 'error'])
		fail = false
		autosave.schedule(a, () => state)
		await autosave.flush()
		expect(statuses).toEqual(['saving', 'error', 'saving', 'saved'])
		expect(calls).toEqual(['layout a t'])
	})

	it('clears an error once nothing is left to write', async () => {
		const { store } = memoryStore()
		const failing: DiagramStore = {
			...store,
			saveLayout: async () => {
				throw new Error('timeout')
			},
		}
		const statuses: SaveStatus[] = []
		const autosave = new DiagramAutosave(0, (_owner, status) =>
			statuses.push(status),
		)
		const a = new DiagramSync(failing, 'a')
		autosave.schedule(a, () => ({
			positions: { t: { x: 1, y: 1 } },
			notes: [],
		}))
		await autosave.flush()
		// The move is undone: the stored state is the shown one again.
		autosave.schedule(a, () => ({ positions: {}, notes: [] }))
		await autosave.flush()
		expect(statuses).toEqual(['saving', 'error', 'idle'])
	})
})

describe('diagram sync', () => {
	it('writes a note under its stored id while the canvas keeps the temporary one', async () => {
		const { store, calls } = memoryStore()
		const sync = new DiagramSync(store, 'a')
		await sync.save({ positions: {}, notes: [note('temp-1', 'hi')] })
		expect(
			sync.hasChanges({ positions: {}, notes: [note('temp-1', 'hi')] }),
		).toBe(false)
		await sync.save({ positions: {}, notes: [note('temp-1', 'hi there')] })
		await sync.save({ positions: {}, notes: [] })
		expect(calls).toEqual(['create a hi', 'update n1 hi there', 'delete n1'])
	})
})

describe('diagram history', () => {
	it('undoes a note created and gives it back on redo', () => {
		const state: DiagramState = { positions: {}, notes: [note('n1', 'x')] }
		const history = new DiagramHistory()
		history.push({ kind: 'noteCreate', snapshot: note('n1', 'x') })
		history.push(
			{ kind: 'noteDelete', snapshot: note('n1', 'x') },
			Date.now() + 1000,
		)
		state.notes = []
		expect(history.undo(state)).toBe(true)
		expect(state.notes.map((n) => n.id)).toEqual(['n1'])
		expect(history.undo(state)).toBe(true)
		expect(state.notes).toEqual([])
		expect(history.redo(state)).toBe(true)
		expect(state.notes.map((n) => n.id)).toEqual(['n1'])
	})
})

describe('grabbing a node', () => {
	function inNode(id: string | null): EventTarget {
		const node = id
			? { getAttribute: (name: string) => (name === 'data-id' ? id : null) }
			: null
		return {
			closest: (selector: string) =>
				selector === '.vue-flow__node' ? node : null,
		} as unknown as EventTarget
	}

	it('finds the node a press lands on', () => {
		expect(pressedNodeId(inNode('shop::orders'))).toBe('shop::orders')
		expect(pressedNodeId(inNode(null))).toBeNull()
		expect(pressedNodeId(null)).toBeNull()
		expect(pressedNodeId({} as EventTarget)).toBeNull()
	})

	it('lets go of every other selected node, so only the grabbed one moves', () => {
		const note = { id: 'note::n1' }
		const other = { id: 'note::n2' }
		// A selected note does not follow a table: tables are never selected.
		expect(nodesToRelease([note], 'shop::orders')).toEqual([note])
		expect(nodesToRelease([note, other], 'note::n1')).toEqual([other])
		expect(nodesToRelease([note], 'note::n1')).toEqual([])
		expect(nodesToRelease([], 'shop::orders')).toEqual([])
	})
})
