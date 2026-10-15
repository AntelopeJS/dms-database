import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { serverRender, type BackendRead } from './fixtures/serverRender'
import ConnectionStatus from '../app/components/ConnectionStatus.vue'
import DataBrowser from '../app/components/DataBrowser.vue'
import QueryConsole from '../app/components/QueryConsole.vue'
import SchemaDiagram from '../app/components/SchemaDiagram.vue'
import SchemasFilterBar from '../app/components/SchemasFilterBar.vue'
import TableInspector from '../app/components/TableInspector.vue'

// What a server render of each page reads, and that the browser is handed
// every response it read: a read the page does not hand over is made again
// by the browser, after a server request for nothing.

const table = (name: string) => ({
	name,
	fields: { _id: { kind: 'string' } },
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

function backend({ url, query }: BackendRead): unknown {
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
			return { status: 'ok', latencyMs: 3, driver: 'MongoDB', storage: [] }
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
	props: Record<string, unknown> = {},
	url = '/',
) => serverRender(component, props, { url, respond: backend })

describe('server render: every read is handed to the browser', () => {
	it('data browser: the table counts of the first schema', async () => {
		const page = await render(DataBrowser, {}, '/modules/database/data')
		expect(page.reads.map((read) => read.url)).toEqual([
			'/api/database/schemas',
			'/api/database/browse/tables',
		])
		expect(page.reads[1]!.query).toEqual({ filter_schema: 'is:audit' })
		expect(page.untransferred).toEqual([])
		expect(page.html).toContain('4242')
	})

	it('data browser: a table link reads its schema and instance', async () => {
		const page = await render(
			DataBrowser,
			{},
			'/modules/database/data?schema=shop&table=orders&instance=eu',
		)
		expect(page.reads[1]!.query).toEqual({
			filter_schema: 'is:shop',
			filter_instance: 'is:eu',
		})
		expect(page.untransferred).toEqual([])
		expect(page.html).toContain('>7<')
	})

	it('query console: the library, saved, shared and run', async () => {
		const page = await render(QueryConsole, {}, '/modules/database/query')
		expect(page.reads.map((read) => read.url).sort()).toEqual([
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
			'/api/database/schemas',
		])
		expect(page.untransferred).toEqual([])
	})

	it('diagram: no layout or notes either once the schemas are in', async () => {
		// A block of the page read the schemas before the diagram's setup ran.
		const SchemasFirst = defineComponent({
			async setup() {
				await useApiData('/api/database/schemas')
				return () => h(SchemaDiagram)
			},
		})
		const page = await render(SchemasFirst, {}, '/modules/database/diagram')
		expect(page.reads.map((read) => read.url)).toEqual([
			'/api/database/schemas',
		])
		expect(page.untransferred).toEqual([])
	})

	it('table inspector: the rows of the table in every instance', async () => {
		const page = await render(
			TableInspector,
			{ rowData: { schema: 'shop', name: 'orders' } },
			'/modules/database/schemas',
		)
		expect(page.reads.map((read) => read.url).sort()).toEqual([
			'/api/database/browse/count',
			'/api/database/schemas',
		])
		expect(page.untransferred).toEqual([])
		expect(page.html).toContain('9876')
	})

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
		// The counts only, not the rows the route lists.
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
		// The browser hydrates a few seconds after the server rendered: the age
		// of the probe must not follow the clock before the page is mounted.
		const checkedAt = '2026-10-15T20:00:00.000Z'
		const health = (read: BackendRead) =>
			read.url === '/api/database/health'
				? { ...(backend(read) as object), checkedAt }
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
