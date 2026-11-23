import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	menuLocks,
	serverRender,
	type BackendAnswer,
	type BackendRead,
	type MountValue,
} from './fixtures/serverRender'
import ConnectionStatus from '../app/components/ConnectionStatus.vue'
import DataBrowser from '../app/components/DataBrowser.vue'
import DataGrid from '../app/components/DataGrid.vue'
import QueryConsole from '../app/components/QueryConsole.vue'
import SchemaDiagram from '../app/components/SchemaDiagram.vue'
import SchemasFilterBar from '../app/components/SchemasFilterBar.vue'
import TableInspector from '../app/components/TableInspector.vue'
import { ConnectionsFirstSwitcher } from './fixtures/connectionsFirstSwitcher'
import { SchemasFirstDiagram } from './fixtures/schemasFirstDiagram'
import { present } from './fixtures/present'
import {
	WAREHOUSE,
	connectionsAnswer,
	connectionsState,
} from './fixtures/connections'

const CONNECTIONS_URL = '/api/database/connections'

const table = (name: string) => ({
	name,
	fields: {
		_id: { kind: 'string' },
		note: { kind: 'union', members: [{ kind: 'string' }, { kind: 'null' }] },
	},
	indexes: {},
	relations: [],
})
const schema = (id: string, instances: string[] = []) => ({
	id,
	options: {},
	tables: [table('orders'), table('customers')],
	stats: { tableCount: 2, elementCount: 3, instanceCount: instances.length },
	instances,
})

const HEALTH = { status: 'ok', latencyMs: 3, driver: 'MongoDB', storage: [] }

function backend({ url, query }: BackendRead): BackendAnswer {
	switch (url) {
		case '/api/database/schemas':
			return { schemas: [schema('audit'), schema('shop', ['eu'])] }
		case '/api/database/browse/tables':
			return {
				items: [
					{ name: 'orders', elementCount: query.filter_instance ? 7 : 4242 },
					{ name: 'customers', elementCount: 31 },
				],
			}
		case '/api/database/health':
			return HEALTH
		case '/api/database/query/saved':
			return {
				items:
					query.scope === 'shared'
						? [query_('team-query', 'Teammate query', 'other')]
						: [query_('own-query', 'My saved query', 'me')],
			}
		case '/api/database/query/history':
			return {
				items: [
					{
						id: 'run-1',
						userId: 'me',
						query: {},
						source: 'db.schema("shop").table("orders")',
						language: 'aql',
						executedAt: '2026-10-14T08:00:00.000Z',
						durationMs: 12,
						rowCount: 3,
						status: 'ok',
						mutation: false,
					},
				],
			}
		case '/api/database/browse/count':
			return { total: 9876 }
		case '/api/database/tables/source':
			return { total: 12, all: 40, results: [{ _id: 'shop::orders' }] }
		default:
			return {}
	}
}

function query_(id: string, name: string, userId: string) {
	return {
		id,
		userId,
		name,
		description: '',
		query: {},
		source: `db.schema("shop") // ${name}`,
		language: 'aql',
		shared: userId !== 'me',
		createdAt: '2026-10-01T10:00:00.000Z',
		updatedAt: '2026-10-01T10:00:00.000Z',
	}
}

const render = (
	component: Parameters<typeof serverRender>[0],
	props: Record<string, MountValue> = {},
	url = '/',
) => serverRender(component, props, { url, respond: backend })

describe('server render: every read is handed to the browser', () => {
	it('data browser: the table counts of the first schema', async () => {
		const page = await render(DataBrowser, {}, '/modules/database/data')
		const reads = page.reads.filter((read) => read.url !== CONNECTIONS_URL)
		expect(reads.map((read) => read.url)).toEqual([
			'/api/database/schemas',
			'/api/database/browse/tables',
		])
		expect(present(reads[1], 'the tables read').query).toEqual({
			filter_schema: 'is:audit',
		})
		expect(page.untransferred).toEqual([])
		expect(page.html).toContain('4242')
	})

	it('data browser: a table link reads its schema and instance', async () => {
		const page = await render(
			DataBrowser,
			{},
			'/modules/database/data?schema=shop&table=orders&instance=eu',
		)
		const reads = page.reads.filter((read) => read.url !== CONNECTIONS_URL)
		expect(present(reads[1], 'the tables read').query).toEqual({
			filter_schema: 'is:shop',
			filter_instance: 'is:eu',
		})
		expect(page.untransferred).toEqual([])
		expect(page.html).toContain('>7<')
	})

	it('data browser: the table list stacks above the grid below md', async () => {
		const page = await render(DataBrowser, {}, '/modules/database/data')
		const root = page.html.match(/^<div class="([^"]*)"/)?.[1]?.split(' ')
		const aside = page.html.match(/<aside class="([^"]*)"/)?.[1]?.split(' ')
		expect(root).toEqual(expect.arrayContaining(['flex-col', 'md:flex-row']))
		expect(aside).toEqual(
			expect.arrayContaining(['w-full', 'max-h-[40vh]', 'border-b']),
		)
		expect(aside).toEqual(
			expect.arrayContaining(['md:w-[264px]', 'md:max-h-none', 'md:border-r']),
		)
		expect(aside).not.toContain('w-[264px]')
	})

	it('data browser: the stacked grid keeps a usable height below md', async () => {
		const browser = await render(DataBrowser, {}, '/modules/database/data')
		const root = browser.html.match(/^<div class="([^"]*)"/)?.[1]?.split(' ')
		expect(root).toEqual(expect.arrayContaining(['min-h-fit', 'md:min-h-0']))
		expect(root).not.toContain('min-h-0')

		const grid = await render(
			DataGrid,
			{
				tab: {
					id: 'shop.orders',
					schema: 'shop',
					instance: '',
					table: 'orders',
				},
			},
			'/modules/database/data?schema=shop&table=orders',
		)
		const scroller = grid.html
			.match(/<div class="([^"]*scroll-pl-14[^"]*)"/)?.[1]
			?.split(' ')
		expect(scroller).toEqual(expect.arrayContaining(['min-h-80', 'md:min-h-0']))
		expect(scroller).not.toContain('min-h-0')
	})

	it('query console: the library, saved, shared and run', async () => {
		const page = await render(QueryConsole, {}, '/modules/database/query')
		expect(page.reads.map((read) => read.url).sort()).toEqual([
			CONNECTIONS_URL,
			'/api/database/query/history',
			'/api/database/query/saved',
			'/api/database/query/saved',
			'/api/database/schemas',
		])
		expect(page.untransferred).toEqual([])
		expect(page.html).toContain(
			'db.schema(&quot;shop&quot;).table(&quot;orders&quot;)',
		)
	})

	it('diagram: no layout or notes, which only the browser draws', async () => {
		const page = await render(SchemaDiagram, {}, '/modules/database/diagram')
		expect(page.reads.map((read) => read.url)).toEqual([
			CONNECTIONS_URL,
			'/api/database/schemas',
		])
		expect(page.untransferred).toEqual([])
	})

	it('diagram: no layout or notes either once the schemas are in', async () => {
		const page = await render(
			SchemasFirstDiagram,
			{},
			'/modules/database/diagram',
		)
		expect(page.reads.map((read) => read.url)).toEqual([
			'/api/database/schemas',
			CONNECTIONS_URL,
		])
		expect(page.untransferred).toEqual([])
	})
})

describe('server render: every read of the table inspector is handed to the browser', () => {
	it('table inspector: the rows of the table in every instance', async () => {
		const page = await render(
			TableInspector,
			{ rowData: { schema: 'shop', name: 'orders' } },
			'/modules/database/schemas',
		)
		expect(page.reads.map((read) => read.url).sort()).toEqual([
			'/api/database/browse/count',
			CONNECTIONS_URL,
			'/api/database/schemas',
		])
		expect(page.untransferred).toEqual([])
		expect(page.html).toContain('9876')
	})

	it('database switcher: sets no sidebar lock in a server render, even once the connections are read, which the sidebar it renders before would hydrate against a locked client state', async () => {
		menuLocks.value = []
		await serverRender(
			ConnectionsFirstSwitcher,
			{},
			{
				url: '/modules/database/data',
				respond: (read) =>
					read.url === CONNECTIONS_URL
						? connectionsAnswer(connectionsState(WAREHOUSE))
						: backend(read),
			},
		)
		expect(menuLocks.value).toEqual([])
	})

	it('table inspector on an external database: offers the diagram and not the query console, which an inspector linking to a locked page would not', async () => {
		const external = connectionsState(WAREHOUSE)
		const page = await serverRender(
			TableInspector,
			{ rowData: { schema: 'shop', name: 'orders' } },
			{
				url: '/modules/database/schemas',
				respond: (read) =>
					read.url === CONNECTIONS_URL
						? connectionsAnswer(external)
						: backend(read),
			},
		)
		expect(page.untransferred).toEqual([])
		expect(page.html).toContain('dms_database.inspector.actions.browse')
		expect(page.html).not.toContain('dms_database.inspector.actions.query')
		expect(page.html).toContain('dms_database.inspector.actions.diagram')
	})

	it('table inspector: counts instances on the project database only, which an inspector reading 1 instance on an external database gets wrong', async () => {
		const INSTANCES = 'dms_database.inspector.instances'
		const own = await render(
			TableInspector,
			{ rowData: { schema: 'shop', name: 'orders' } },
			'/modules/database/schemas',
		)
		expect(own.html).toContain(INSTANCES)
		const external = await serverRender(
			TableInspector,
			{ rowData: { schema: 'shop', name: 'orders' } },
			{
				url: '/modules/database/schemas',
				respond: (read) =>
					read.url === CONNECTIONS_URL
						? connectionsAnswer(connectionsState(WAREHOUSE))
						: backend(read),
			},
		)
		expect(external.html).not.toContain(INSTANCES)
	})
})

describe('server render: what the table inspector shows', () => {
	it('table inspector: leaves the position and steps to the DMS header', async () => {
		const page = await render(
			TableInspector,
			{
				rowData: { schema: 'shop', name: 'orders' },
				navigation: {
					index: 2,
					total: 87,
					hasPrev: true,
					hasNext: true,
					prev: () => {},
					next: () => {},
				},
			},
			'/modules/database/schemas',
		)
		expect(page.html).toContain('orders')
		expect(page.html).not.toMatch(/3\s*\/\s*87/)
		expect(page.html).not.toContain('i-ph-caret-up')
		expect(page.html).not.toContain('i-ph-caret-down')
	})

	it('table inspector: the name in the header only, the columns at their width', async () => {
		const page = await render(
			TableInspector,
			{ rowData: { schema: 'shop', name: 'orders' } },
			'/modules/database/schemas',
		)
		expect(page.html).not.toMatch(/<h3[^>]*>\s*orders/)
		expect(page.html).toMatch(
			/data-columns-scroller[^>]*overflow-x-auto|overflow-x-auto[^>]*data-columns-scroller/,
		)
		expect(page.html).toContain('min-w-[30rem]')
		expect(page.html).toContain('whitespace-nowrap')
		expect(page.html).toContain('data-drawer-tabs')
		expect(page.html).not.toContain('string | null')
		expect(page.html).not.toContain('border-dashed')
		expect(page.html).toContain('dms_database.inspector.cols.nullable')
		expect(page.html).toContain('dms_database.inspector.cols.not_nullable')
	})

	it('table inspector: a column named like an Object member is listed like any other', async () => {
		const members = {
			name: 'members',
			fields: { _id: { kind: 'string' }, constructor: { kind: 'string' } },
			indexes: {},
			relations: [],
			modifiers: {},
		}
		const page = await serverRender(
			TableInspector,
			{ rowData: { schema: 'quirks', name: 'members' } },
			{
				url: '/modules/database/schemas',
				respond: (read) =>
					read.url === '/api/database/schemas'
						? { schemas: [{ ...schema('quirks'), tables: [members] }] }
						: backend(read),
			},
		)
		expect(page.html).toMatch(/>\s*constructor\s*</)
		expect(page.html).toContain('i-ph-text-aa')
	})
})

describe('server render: every read of the filter bar and the overview is handed to the browser', () => {
	it('schemas filter bar: the tables listed out of all', async () => {
		const page = await render(
			SchemasFilterBar,
			{},
			'/modules/database/schemas?scope=shop',
		)
		expect(page.reads).toContainEqual({
			url: '/api/database/tables/source',
			method: 'GET',
			query: { filter_scope: 'is:shop' },
		})
		expect(page.untransferred).toEqual([])
		expect(page.html).toMatch(/12[^<]*40/)
		expect(Object.values(page.payload.data)).toContainEqual({
			total: 12,
			all: 40,
		})
	})

	it('overview: the connection health', async () => {
		const page = await render(
			ConnectionStatus,
			{},
			'/modules/database/overview',
		)
		expect(page.reads.map((read) => read.url)).toEqual(['/api/database/health'])
		expect(page.untransferred).toEqual([])
	})
})

describe('server render: what the browser hydrates the same', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('overview: the probe age, whenever the page renders', async () => {
		const checkedAt = '2026-10-15T20:00:00.000Z'
		const health = (read: BackendRead) =>
			read.url === '/api/database/health'
				? { ...HEALTH, checkedAt }
				: backend(read)
		const renderAt = async (time: string) => {
			vi.useFakeTimers({ toFake: ['Date'] })
			vi.setSystemTime(new Date(time))
			const page = await serverRender(
				ConnectionStatus,
				{},
				{
					url: '/modules/database/overview',
					respond: health,
				},
			)
			vi.useRealTimers()
			return page.html
		}
		const rendered = await renderAt('2026-10-15T20:00:00.400Z')
		expect(rendered).toContain('checked_seconds 0')
		expect(await renderAt('2026-10-15T20:00:07.000Z')).toBe(rendered)
	})
})
