import { describe, expect, it } from 'vitest'
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

describe('diagram page on an external database', () => {
	it('shows the locked state with the lock icon and the reason, and reads nothing but the selection', async () => {
		const page = await mount(SchemaDiagram)
		expect(page.text()).toContain(LOCKED)
		expect(page.text()).toContain('icon="i-ph-lock"')
		expect(page.text()).toContain('dms_database.connections.locked.reason')
		expect(page.reads.map((read) => read.url)).toEqual([CONNECTIONS_URL])
		expect(page.errors).toEqual([])
	})

	it('is locked by what the connection lists, not by being external', async () => {
		const page = await mount(
			SchemaDiagram,
			connectionsState({ ...WAREHOUSE, unsupported: ['queryConsole'] }),
		)
		expect(page.text()).not.toContain(LOCKED)
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

	it('stays open when only the diagram is listed as unsupported', async () => {
		const page = await mount(
			QueryConsole,
			connectionsState({ ...WAREHOUSE, unsupported: ['diagram'] }),
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
