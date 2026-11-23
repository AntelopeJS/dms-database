import { afterEach, expect, it, vi } from 'vitest'
import { inertia } from './fixtures/inertia'
import { browserMount } from './fixtures/serverRender'
import {
	OWN,
	connectionsBackend,
	connectionsState,
} from './fixtures/connections'
import DataBrowser from '../app/components/DataBrowser.vue'

afterEach(() => {
	vi.unstubAllGlobals()
	inertia.visits.length = 0
	inertia.page.url = '/modules/database/data'
})

const ORDERS = {
	id: 'shop::__DEFAULT__::orders',
	schema: 'shop',
	instance: '__DEFAULT__',
	table: 'orders',
	preview: false,
}

interface StoredTabs {
	database: string
	tabs: (typeof ORDERS)[]
	activeId: string
}

function isStoredTabs(value: unknown): value is { tabs: unknown[] } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'tabs' in value &&
		Array.isArray(value.tabs)
	)
}

function parseStored(text: string): { tabs: unknown[] } {
	const value: unknown = JSON.parse(text)
	if (!isStoredTabs(value)) throw new Error(`not the saved tabs: ${text}`)
	return value
}

/** A browser tab whose sessionStorage holds `saved`, recording each write. */
function storing(saved: StoredTabs, url = '/modules/database/data') {
	inertia.page.url = url
	let raw = JSON.stringify(saved)
	const writes: string[] = []
	vi.stubGlobal('window', {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		location: {
			origin: 'http://localhost',
			href: `http://localhost${url}`,
			pathname: '/modules/database/data',
		},
		localStorage: { getItem: () => null, setItem: vi.fn() },
		sessionStorage: {
			getItem: () => raw,
			setItem: (_key: string, value: string) => {
				raw = value
				writes.push(value)
			},
			removeItem: vi.fn(),
		},
	})
	return { writes, saved: () => parseStored(raw) }
}

it('keeps the saved tabs and the table link of the selected database when the page arrives with no connections read yet, which a selection watch running before the restore gets wrong', async () => {
	const storage = storing(
		{ database: 'own', tabs: [ORDERS], activeId: ORDERS.id },
		'/modules/database/data?schema=shop&table=orders',
	)
	const page = browserMount(
		DataBrowser,
		connectionsBackend(connectionsState(OWN), { others: () => [] }),
	)
	await page.shown
	await new Promise((resolve) => setTimeout(resolve, 0))
	expect(inertia.visits).toEqual([])
	expect(storage.writes.map(parseStored)).not.toContainEqual(
		expect.objectContaining({ tabs: [] }),
	)
	expect(storage.saved()).toMatchObject({
		database: 'own',
		tabs: [expect.objectContaining({ id: ORDERS.id })],
	})
})
