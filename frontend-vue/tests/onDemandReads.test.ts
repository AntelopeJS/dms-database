import { describe, expect, it } from 'vitest'
import {
	inBrowser,
	serverRender,
	type BackendRead,
} from './fixtures/serverRender'
import { useDiagramPersistence } from '../app/build/composables/useDiagramPersistence'
import { useQueryStore } from '../app/build/composables/useQueryStore'
import InstancePicker from '../app/components/InstancePicker.vue'
import JsonCellPanel from '../app/components/JsonCellPanel.vue'
import RowDrawer from '../app/components/RowDrawer.vue'

// The reads the module makes on demand go through `useApiData` too
// (`immediate: false` + `execute()`): nothing on the server, nothing before
// they are asked for, and a fresh read each time they are.

const NOTE = {
	id: 'n1',
	schemaName: 'shop',
	text: 'Orders',
	x: 0,
	y: 0,
	width: 200,
	height: 100,
	color: null,
	createdAt: '2026-10-01T10:00:00.000Z',
	updatedAt: '2026-10-01T10:00:00.000Z',
}

let layoutVersion = 0

function backend({ url }: BackendRead): unknown {
	if (url === '/api/database/diagram/layout/shop')
		return { positions: { orders: { x: layoutVersion++, y: 0 } } }
	if (url === '/api/database/diagram/notes') return { items: [NOTE] }
	if (url === '/api/database/diagram/layout/broken')
		throw Object.assign(new Error('Unavailable'), { statusCode: 503 })
	if (url === '/api/database/query/history/run-1')
		return { id: 'run-1', source: 'db.schema("shop")' }
	return { items: [] }
}

describe('reads on demand', () => {
	it("the diagram reads a schema's layout and notes when the canvas asks, each time", async () => {
		layoutVersion = 0
		const browser = inBrowser(useDiagramPersistence, backend)
		expect(browser.reads).toEqual([])
		const first = await browser.value.readDiagram('shop')
		expect(first).toEqual({
			schema: 'shop',
			positions: { orders: { x: 0, y: 0 } },
			notes: [NOTE],
		})
		expect(browser.reads.map((read) => read.url).sort()).toEqual([
			'/api/database/diagram/layout/shop',
			'/api/database/diagram/notes',
		])
		expect(browser.reads[1]!.query).toEqual({ schema: 'shop' })
		// The canvas edits a working copy: a new load reads what is stored now.
		const second = await browser.value.readDiagram('shop')
		expect(second.positions).toEqual({ orders: { x: 1, y: 0 } })
	})

	it('the diagram says so when its layout cannot be read', async () => {
		const browser = inBrowser(useDiagramPersistence, backend)
		await expect(browser.value.readDiagram('broken')).rejects.toMatchObject({
			statusCode: 503,
		})
	})

	it('the console reads a linked run when it opens it, not before', async () => {
		const browser = inBrowser(useQueryStore, backend)
		await browser.value.libraryRead
		const before = browser.reads.length
		const entry = await browser.value.fetchHistoryEntry('run-1')
		expect(entry).toMatchObject({ id: 'run-1' })
		expect(browser.reads.slice(before).map((read) => read.url)).toEqual([
			'/api/database/query/history/run-1',
		])
	})
})

describe('server render: what only the browser reads', () => {
	it("a row's drawer leaves its references to the browser", async () => {
		const page = await serverRender(
			RowDrawer,
			{
				tab: { id: 't', schema: 'shop', table: 'orders', instance: '' },
				rowId: 'r1',
				row: { _id: 'r1' },
				columns: [],
				onStage: () => undefined,
			},
			{ respond: backend },
		)
		expect(page.reads).toEqual([])
	})

	it("a row's drawer: values given the room, an even end slot, a sticky footer", async () => {
		const page = await serverRender(RowDrawer, {
			tab: { id: 't', schema: 'shop', table: 'orders', instance: '' },
			rowId: 'r1',
			row: {
				_id: 'r1',
				status: 'open',
				pinned: true,
				description:
					'A long description that runs past what the value column shows.',
				address: { city: 'Liège' },
			},
			columns: [
				{ name: '_id', type: 'string', isPrimaryKey: true },
				{ name: 'status', type: 'string', isPrimaryKey: false },
				{ name: 'pinned', type: 'boolean', isPrimaryKey: false },
				{ name: 'description', type: 'string', isPrimaryKey: false },
				{ name: 'address', type: 'object', isPrimaryKey: false },
			],
			readOnly: false,
			navigation: {
				index: 0,
				total: 50,
				hasPrev: false,
				hasNext: true,
				prev: () => undefined,
				next: () => undefined,
			},
			onStage: () => undefined,
			onReview: () => undefined,
		})
		// The DMS row header holds the position and the steps.
		expect(page.html).not.toMatch(/1\s*\/\s*50/)
		expect(page.html).not.toContain('i-ph-caret-up')
		expect(page.html).toContain('data-row-scope')
		// A short value beside its label, a long text and JSON across the row.
		const row = (field: string) =>
			page.html.match(
				new RegExp(`<div[^>]*data-field-row="${field}"[^>]*>`),
			)?.[0] ?? ''
		expect(row('status')).toContain('layout="form"')
		expect(row('description')).toContain('layout="stack"')
		expect(row('address')).toContain('layout="stack"')
		expect(page.html.match(/data-stub="DmsTextarea"/g)).toHaveLength(2)
		// Every editable field, the switch too, keeps the same end slot.
		expect(page.html.match(/data-null-slot/g)).toHaveLength(4)
		expect(page.html.match(/icon="i-ph-circle-dashed"/g)).toHaveLength(4)
		// The DMS footer, at the drawer's bottom.
		expect(page.html).toMatch(
			/data-stub="DmsContainerFooter"[^>]*data-row-footer|data-row-footer[^>]*data-stub="DmsContainerFooter"/,
		)
	})

	it("a structured cell's JSON editor is a drawer body, with its own Apply and Cancel", async () => {
		const page = await serverRender(JsonCellPanel, {
			column: 'address',
			value: { city: 'Liège' },
			readOnly: false,
		})
		expect(page.reads).toEqual([])
		// The DMS drawer is the surface: no slideover of its own.
		expect(page.html).not.toContain('USlideover')
		expect(page.html).toContain('DmsInputCode')
		// Stacked for the drawer: the label above an editor across it, which
		// fills the drawer's height, never fewer than 12 lines.
		expect(page.html).toMatch(/layout="stack"[^>]*fill/)
		expect(page.html).toMatch(/fill[^>]*min-lines="12"/)
		expect(page.html).not.toContain('max-lines')
		expect(page.html).toContain('data-stub="DmsContainerFooter"')
		expect(page.html).toContain('dms_database.data.json.apply')
		expect(page.html).toContain('dms_database.common.cancel')
		const readOnly = await serverRender(JsonCellPanel, {
			column: 'address',
			value: { city: 'Liège' },
			readOnly: true,
		})
		expect(readOnly.html).not.toContain('dms_database.data.json.apply')
		expect(readOnly.html).toContain('dms_database.common.cancel')
	})

	it('the instance picker reads nothing until its menu opens', async () => {
		const page = await serverRender(
			InstancePicker,
			{ modelValue: { kind: 'default' }, schema: 'shop' },
			{ respond: backend },
		)
		expect(page.reads).toEqual([])
	})
})
