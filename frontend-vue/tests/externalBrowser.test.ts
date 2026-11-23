import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { provideReadOnlyReason } from '../app/build/data/readOnlyReason'
import {
	browserMount,
	drawers,
	isPropHandler,
	propText,
	type BackendAnswer,
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
import TableInspector from '../app/components/TableInspector.vue'

const PICKER = 'data-dms-database-instance-picker'
const TAB = {
	id: 'public::__DEFAULT__::orders',
	schema: 'public',
	instance: '__DEFAULT__',
	table: 'orders',
}

function others({ url }: BackendRead): BackendAnswer {
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
		page.find((props) => propText(props['aria-label']).endsWith('open_row'))
			?.onClick
	await vi.waitFor(() => expect(openRow()).toBeTypeOf('function'))
	await vi.waitFor(() =>
		expect(page.reads.map((read) => read.url)).toContain(CONNECTIONS_URL),
	)
	await new Promise((resolve) => setTimeout(resolve, 0))
	const open = openRow()
	if (isPropHandler(open)) open()
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

	it('still warns that the counts failed on an external database, which a footer hidden for every external database gets wrong', async () => {
		const page = browserMount(
			DataBrowserSidebar,
			connectionsBackend(connectionsState(WAREHOUSE), {
				others: (read) => {
					if (read.url === '/api/database/browse/tables')
						throw Object.assign(new Error('down'), { statusCode: 500 })
					return { items: [] }
				},
			}),
			{ schemas: [{ id: 'erp', tables: [] }], loading: false, error: false },
		)
		await page.shown
		await vi.waitFor(() =>
			expect(page.text()).toContain('dms_database.data.scope.counts_failed'),
		)
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
				propText(props.class).includes('align-middle'),
		)
		return { title: cell?.title, cursor: propText(cell?.class) }
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

const SAMPLE_POSITION = 'dms_database.inspector.sample.position'

async function samplePosition(connection: DatabaseConnection) {
	const page = browserMount(
		TableInspector,
		connectionsBackend(connectionsState(connection), {
			others: ({ url }): BackendAnswer => {
				if (url === '/api/database/schemas')
					return {
						schemas: [
							{
								id: 'shop',
								options: {},
								tables: [
									{
										name: 'orders',
										fields: { _id: { kind: 'string' } },
										indexes: {},
										relations: [],
									},
								],
								stats: { tableCount: 1, elementCount: 3, instanceCount: 0 },
								instances: [],
							},
						],
					}
				if (url === '/api/database/browse/count') return { total: 3 }
				if (url === '/api/database/browse/list')
					return { results: [{ _id: '1' }], total: 3, primaryKey: '_id' }
				return { items: [] }
			},
		}),
		{ rowData: { schema: 'shop', name: 'orders' } },
	)
	await page.shown
	await vi.waitFor(() => {
		const update = page.find((props) => Array.isArray(props.items))?.[
			'onUpdate:modelValue'
		]
		if (isPropHandler(update)) update('sample')
		expect(page.text()).toContain(SAMPLE_POSITION)
	})
	return page.text()
}

describe('the Schemas drawer sample row', () => {
	it('names the instance on the project database only, which a position reading default instance on an external database gets wrong', async () => {
		const own = await samplePosition(OWN)
		expect(own).toContain(`${SAMPLE_POSITION} `)
		const external = await samplePosition(WAREHOUSE)
		expect(external).toContain(`${SAMPLE_POSITION}_uninstanced`)
		expect(external).not.toContain(`${SAMPLE_POSITION} `)
	})
})
