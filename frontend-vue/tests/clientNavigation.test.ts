import { describe, expect, it } from 'vitest'
import {
	browserMount,
	type BackendAnswer,
	type BackendRead,
} from './fixtures/serverRender'
import ConnectionStatus from '../app/components/ConnectionStatus.vue'
import QueryConsole from '../app/components/QueryConsole.vue'

const schema = (id: string) => ({
	id,
	options: {},
	tables: [
		{ name: 'orders', fields: {}, indexes: {}, relations: [] },
		{ name: 'customers', fields: {}, indexes: {}, relations: [] },
	],
	stats: { tableCount: 2, elementCount: 3, instanceCount: 0 },
	instances: [],
})

function answer({ url }: BackendRead): BackendAnswer {
	switch (url) {
		case '/api/database/health':
			return {
				status: 'ok',
				latencyMs: 3,
				driver: 'MongoDB',
				checkedAt: '2026-10-18T10:00:00.000Z',
				storage: [],
			}
		case '/api/database/schemas':
			return { schemas: [schema('shop')] }
		default:
			return { items: [] }
	}
}

/** A backend whose answers wait for `release()`. */
function heldBackend(respond: (read: BackendRead) => BackendAnswer = answer) {
	let release!: () => void
	const released = new Promise<void>((resolve) => (release = resolve))
	return {
		respond: async (read: BackendRead) => {
			await released
			return respond(read)
		},
		release,
	}
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 10; turn++) await new Promise((r) => setTimeout(r))
}

async function isShown(shown: Promise<void>): Promise<boolean> {
	let done = false
	void shown.then(() => (done = true))
	await settle()
	return done
}

describe('client navigation: the page lands with what decides its size', () => {
	it('overview connection: the first probe, not the empty health', async () => {
		const backend = heldBackend()
		const page = browserMount(ConnectionStatus, backend.respond)
		expect(await isShown(page.shown)).toBe(false)

		backend.release()
		await page.shown
		expect(page.text()).toContain('MongoDB')
		expect(page.errors).toEqual([])
	})

	it('query console: the first run examples and the library', async () => {
		const backend = heldBackend()
		const page = browserMount(QueryConsole, backend.respond)
		expect(await isShown(page.shown)).toBe(false)

		backend.release()
		await page.shown
		expect(page.reads.map((read) => read.url)).toContain(
			'/api/database/schemas',
		)
		expect(page.text()).toContain('first_description')
		expect(page.text()).toContain('shop.orders')
		expect(page.errors).toHaveLength(1)
		expect(String(page.errors[0])).toContain('document is not defined')
	})
})
