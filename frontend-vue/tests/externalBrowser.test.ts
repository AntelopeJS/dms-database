import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { provideReadOnlyReason } from '../app/build/data/readOnlyReason'
import {
	browserMount,
	drawers,
	type BackendRead,
} from './fixtures/serverRender'
import {
	CONNECTIONS_URL,
	OWN,
	WAREHOUSE,
	connectionsBackend,
	connectionsState,
} from './fixtures/connections'
import type { DatabaseConnection } from '../app/build/composables/useDatabaseConnections'
import DataBrowserSidebar from '../app/components/DataBrowserSidebar.vue'
import DataGrid from '../app/components/DataGrid.vue'

const PICKER = 'data-dms-database-instance-picker'
const TAB = {
	id: 'public::__DEFAULT__::orders',
	schema: 'public',
	instance: '__DEFAULT__',
	table: 'orders',
}

function others({ url }: BackendRead): unknown {
	if (url === '/api/database/browse/list')
		return { results: [{ _id: '1', total: 5 }], total: 1, primaryKey: '_id' }
	if (url === '/api/database/browse/columns')
		return {
			columns: ['_id', 'total'],
			types: { _id: 'string', total: 'number' },
			primaryKey: '_id',
		}
	return { items: [] }
}

async function openFirstRow(connection: DatabaseConnection | null) {
	const page = browserMount(
		DataGrid,
		connection
			? connectionsBackend(connectionsState(connection), { others })
			: (read) => {
					if (read.url === CONNECTIONS_URL) throw new Error('unreachable')
					return others(read)
				},
		{ tab: TAB },
	)
	await page.shown
	const openRow = () =>
		page.find((props) =>
			Boolean(props['aria-label']?.toString().endsWith('open_row')),
		)?.onClick
	await vi.waitFor(() => expect(openRow()).toBeTypeOf('function'))
	await vi.waitFor(() =>
		expect(page.reads.map((read) => read.url)).toContain(CONNECTIONS_URL),
	)
	await new Promise((resolve) => setTimeout(resolve, 0))
	const open = openRow()
	if (typeof open === 'function') open()
	expect(drawers).toHaveLength(1)
	return drawers[0]?.componentOptions
}

describe('data grid on an external database', () => {
	it('opens a row read-only while the access is read, which an implementation that only reads the tab gets wrong', async () => {
		const options = await openFirstRow(WAREHOUSE)
		expect(options?.readOnly).toBe(true)
	})

	it('opens a row editable once read and write is allowed', async () => {
		const options = await openFirstRow({ ...WAREHOUSE, access: 'read-write' })
		expect(options?.readOnly).toBe(false)
	})

	it('opens a row read-only when the connections could not be read, which an implementation that falls back to the project database gets wrong', async () => {
		const options = await openFirstRow(null)
		expect(options?.readOnly).toBe(true)
	})

	it('opens a row of the project database editable', async () => {
		const options = await openFirstRow(OWN)
		expect(options?.readOnly).toBe(false)
		expect(options?.showReferences).toBe(true)
	})

	it('offers the rows that point at this one only where the connection supports them', async () => {
		expect((await openFirstRow(WAREHOUSE))?.showReferences).toBe(false)
		drawers.length = 0
		const supported = await openFirstRow({ ...WAREHOUSE, unsupported: [] })
		expect(supported?.showReferences).toBe(true)
	})
})

describe('data grid toolbar', () => {
	async function toolbar(connection: DatabaseConnection) {
		const page = browserMount(
			DataGrid,
			connectionsBackend(connectionsState(connection), { others }),
			{ tab: TAB },
		)
		await page.shown
		await vi.waitFor(() =>
			expect(page.reads.map((read) => read.url)).toContain(CONNECTIONS_URL),
		)
		await new Promise((resolve) => setTimeout(resolve, 0))
		return page.text()
	}

	it('links to the query console where it exists', async () => {
		expect(await toolbar(OWN)).toContain('dms_database.data.grid.open_query')
	})

	it('drops the link on an external database, whose console is locked', async () => {
		expect(await toolbar(WAREHOUSE)).not.toContain(
			'dms_database.data.grid.open_query',
		)
	})
})

describe('data browser sidebar', () => {
	async function sidebar(connection: DatabaseConnection) {
		const page = browserMount(
			DataBrowserSidebar,
			connectionsBackend(connectionsState(connection)),
			{ schemas: [], loading: false, error: false },
		)
		await page.shown
		await vi.waitFor(() =>
			expect(page.reads.map((read) => read.url)).toContain(CONNECTIONS_URL),
		)
		await new Promise((resolve) => setTimeout(resolve, 0))
		return page
	}

	it('offers the instance picker on the project database', async () => {
		expect((await sidebar(OWN)).text()).toContain(PICKER)
	})

	it('hides the instance picker on an external database, which has no instances', async () => {
		const page = await sidebar(WAREHOUSE)
		expect(page.text()).not.toContain(PICKER)
		expect(page.text()).not.toContain('dms_database.data.scope.instance')
	})

	it('names the instance its counts are for on the project database only, which an external database without instances would otherwise read as default', async () => {
		const COUNTS_FOR = 'dms_database.data.scope.counts_for'
		expect((await sidebar(OWN)).text()).toContain(COUNTS_FOR)
		expect((await sidebar(WAREHOUSE)).text()).not.toContain(COUNTS_FOR)
	})
})

describe('a read-only external database in the data grid', () => {
	const REASON = 'dms_database.data.save.read_only_access Warehouse'
	const Browser = defineComponent({
		setup() {
			provideReadOnlyReason()
			return () => h(DataGrid, { tab: TAB })
		},
	})

	async function cellTitles(connection: DatabaseConnection) {
		const page = browserMount(
			Browser,
			connectionsBackend(connectionsState(connection), { others }),
		)
		await page.shown
		await vi.waitFor(() =>
			expect(page.reads.map((read) => read.url)).toContain(
				'/api/database/browse/list',
			),
		)
		await new Promise((resolve) => setTimeout(resolve, 0))
		const cell = page.find(
			(props) =>
				props.class !== undefined &&
				'title' in props &&
				String(props.class).includes('align-middle'),
		)
		return { title: cell?.title, cursor: String(cell?.class) }
	}

	it('names why a cell takes no edit where the user tries one, which a grid saying nothing past the access bar gets wrong', async () => {
		const { title, cursor } = await cellTitles(WAREHOUSE)
		expect(title).toBe(REASON)
		expect(cursor).toContain('cursor-not-allowed')
	})

	it('gives no such reason once read and write is allowed', async () => {
		const { title, cursor } = await cellTitles({
			...WAREHOUSE,
			access: 'read-write',
		})
		expect(title).toBeUndefined()
		expect(cursor).not.toContain('cursor-not-allowed')
	})
})

describe('a capped page of an external database in the data grid', () => {
	async function gridText(capped: boolean, search = '') {
		const page = browserMount(
			DataGrid,
			connectionsBackend(connectionsState(WAREHOUSE), {
				others: (read) =>
					read.url === '/api/database/browse/list'
						? { results: [{ _id: '1' }], total: 1, primaryKey: '_id', capped }
						: others(read),
			}),
			{ tab: TAB },
		)
		await page.shown
		await vi.waitFor(() =>
			expect(page.text()).toContain('dms_database.data.grid.rows 1'),
		)
		if (search) {
			const input = page.find(
				(props) => props.placeholder === 'dms_database.data.grid.search',
			)?.['onUpdate:modelValue']
			if (typeof input === 'function') input(search)
			await vi.waitFor(
				() =>
					expect(page.reads.map((read) => read.query.search)).toContain(search),
				{ timeout: 2000 },
			)
		}
		return page.text()
	}

	it('says a search matches among the first rows only, which a grid that drops the API cap gets wrong', async () => {
		expect(await gridText(true, 'retail')).toContain(
			'dms_database.data.grid.capped 10000',
		)
	})

	it('says the count stops at the cap on a page with no search, where nothing is matched', async () => {
		const text = await gridText(true)
		expect(text).toContain('dms_database.data.grid.count_capped 10000')
		expect(text).not.toContain('dms_database.data.grid.capped')
	})

	it('says nothing of a cap on a page that read every row', async () => {
		expect(await gridText(false)).not.toMatch(/grid\.(count_)?capped/)
	})
})
