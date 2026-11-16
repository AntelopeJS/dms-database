import { describe, expect, it, vi } from 'vitest'
import { browserMount } from './fixtures/serverRender'
import {
	CONNECTIONS_URL,
	OWN,
	WAREHOUSE,
	connectionsBackend,
	connectionsState,
} from './fixtures/connections'
import QueryConsole from '../app/components/QueryConsole.vue'
import SchemaDiagram from '../app/components/SchemaDiagram.vue'

const LOCKED = 'data-feature-locked'

async function mount(
	component: typeof QueryConsole | typeof SchemaDiagram,
	state = connectionsState(WAREHOUSE),
) {
	const page = browserMount(component, connectionsBackend(state))
	await page.shown
	return page
}

describe('diagram page', () => {
	const SCHEMAS = {
		schemas: [{ id: 'public', options: {}, tables: [], instances: [] }],
	}
	const REFERENCES_URL =
		'/api/database/connections/warehouse/schemas/public/references'

	async function diagramReads(selected: typeof OWN) {
		const page = browserMount(
			SchemaDiagram,
			connectionsBackend(connectionsState(selected), {
				others: (read) =>
					read.url === '/api/database/schemas'
						? SCHEMAS
						: read.url === REFERENCES_URL
							? { tables: {} }
							: { positions: {}, items: [] },
			}),
		)
		await page.shown
		await vi.waitFor(() =>
			expect(page.reads.map((read) => read.url)).toContain(
				'/api/database/diagram/layout/public',
			),
		)
		expect(page.text()).not.toContain(LOCKED)
		return page.reads.map((read) => read.url)
	}

	it('opens on an external database and reads the references its catalog reports', async () => {
		expect(await diagramReads(WAREHOUSE)).toContain(REFERENCES_URL)
	})

	it('reads no catalog on the project database, whose schema declares its relations', async () => {
		const urls = await diagramReads(OWN)
		expect(urls.filter((url) => url.endsWith('/references'))).toEqual([])
	})
})

describe('query console page on an external database', () => {
	it('shows the locked state with the lock icon and the reason, and reads neither the library nor the schemas', async () => {
		const page = await mount(QueryConsole)
		expect(page.text()).toContain(LOCKED)
		expect(page.text()).toContain('icon="i-ph-lock"')
		expect(page.text()).toContain('dms_database.connections.locked.reason')
		expect(page.reads.map((read) => read.url)).toEqual([CONNECTIONS_URL])
		expect(page.errors).toEqual([])
	})

	it('stays open when only the instances are listed as unsupported', async () => {
		const page = await mount(
			QueryConsole,
			connectionsState({ ...WAREHOUSE, unsupported: ['instances'] }),
		)
		expect(page.text()).not.toContain(LOCKED)
		expect(page.reads.map((read) => read.url)).toContain(
			'/api/database/schemas',
		)
	})

	it('stays open on the project database', async () => {
		const page = await mount(QueryConsole, connectionsState(OWN))
		expect(page.text()).not.toContain(LOCKED)
	})
})
