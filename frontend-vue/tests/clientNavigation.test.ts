import { describe, expect, it } from 'vitest'
import { browserMount, type BackendRead } from './fixtures/serverRender'
import ConnectionStatus from '../app/components/ConnectionStatus.vue'
import QueryConsole from '../app/components/QueryConsole.vue'

// A client navigation shows a page once its components' setups settle: the
// reads that decide a component's size are awaited there, so the page lands
// with them rather than growing (or swapping placeholders) after it.

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

function answer({ url }: BackendRead): unknown {
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
function heldBackend(respond: (read: BackendRead) => unknown = answer) {
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
		// The examples of the first schema's tables are in the empty result.
		expect(page.text()).toContain('first_description')
		expect(page.text()).toContain('shop.orders')
	})
})
