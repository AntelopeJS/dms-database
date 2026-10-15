import { describe, expect, it } from 'vitest'
import {
	inBrowser,
	serverRender,
	type BackendRead,
} from './fixtures/serverRender'
import { useDiagramPersistence } from '../app/build/composables/useDiagramPersistence'
import { useQueryStore } from '../app/build/composables/useQueryStore'
import InstancePicker from '../app/components/InstancePicker.vue'
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

	it('the instance picker reads nothing until its menu opens', async () => {
		const page = await serverRender(
			InstancePicker,
			{ modelValue: { kind: 'default' }, schema: 'shop' },
			{ respond: backend },
		)
		expect(page.reads).toEqual([])
	})
})
