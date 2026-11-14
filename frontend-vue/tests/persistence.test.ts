import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref } from 'vue'
import { useDataBrowserTabs } from '../app/build/composables/useDataBrowserTabs'

afterEach(() => vi.unstubAllGlobals())

function setup() {
	vi.stubGlobal('useDmsState', (_key: string, init: () => unknown) =>
		ref(init()),
	)
	vi.stubGlobal('computed', computed)
	vi.stubGlobal('useDmsRoute', () => ({ query: {} }))
	vi.stubGlobal('useDmsRouter', () => ({ replace: vi.fn() }))
	vi.stubGlobal('useDataBrowserGrid', () => ({ drop: vi.fn() }))
}

it('restores browser session tabs and persists a new permanent tab', () => {
	setup()
	const setItem = vi.fn()
	vi.stubGlobal('window', {
		sessionStorage: {
			getItem: () =>
				JSON.stringify({
					database: 'own',
					tabs: [{ schema: 'sales', instance: 'eu', table: 'orders' }],
					activeId: null,
				}),
			setItem,
		},
	})
	const browser = useDataBrowserTabs()
	browser.restore('own')
	expect(browser.activeId.value).toBe('sales::eu::orders')
	browser.openTab('audit', 'us', 'events', false)
	expect(browser.tabs.value.map((tab) => tab.id)).toEqual([
		'sales::eu::orders',
		'audit::us::events',
	])
	const [key, payload] = setItem.mock.lastCall!
	expect(key).toBe('dms-database:data-browser:tabs')
	expect(JSON.parse(payload).activeId).toBe('audit::us::events')
})

it('drops the tabs kept on another database', () => {
	setup()
	const setItem = vi.fn()
	vi.stubGlobal('window', {
		sessionStorage: {
			getItem: () =>
				JSON.stringify({
					database: 'warehouse',
					tabs: [{ schema: 'sales', instance: 'eu', table: 'orders' }],
					activeId: 'sales::eu::orders',
				}),
			setItem,
		},
	})
	const browser = useDataBrowserTabs()
	browser.restore('own')
	expect(browser.tabs.value).toEqual([])
	expect(browser.activeId.value).toBeNull()
	browser.openTab('audit', 'us', 'events', false)
	expect(JSON.parse(setItem.mock.lastCall![1])).toMatchObject({
		database: 'own',
		tabs: [expect.objectContaining({ id: 'audit::us::events' })],
	})
})

function storing(saved: object) {
	let raw = JSON.stringify(saved)
	vi.stubGlobal('window', {
		sessionStorage: {
			getItem: () => raw,
			setItem: (_key: string, value: string) => {
				raw = value
			},
		},
	})
}

it('drops a tab set saved with no database', () => {
	setup()
	storing({
		tabs: [{ schema: 'sales', instance: 'eu', table: 'orders' }],
		activeId: null,
	})
	const browser = useDataBrowserTabs()
	browser.restore('own')
	expect(browser.tabs.value).toEqual([])
})

it('drops the open tabs of another database when the page comes back to it without a reload', () => {
	setup()
	const states = new Map<string, unknown>()
	vi.stubGlobal('useDmsState', (key: string, init: () => unknown) => {
		if (!states.has(key)) states.set(key, ref(init()))
		return states.get(key)
	})
	storing({ database: 'own', tabs: [], activeId: null })
	const before = useDataBrowserTabs()
	before.restore('own')
	before.openTab('shop', 'eu', 'orders', false)
	const after = useDataBrowserTabs()
	after.restore('warehouse')
	expect(after.tabs.value).toEqual([])
	after.openTab('audit', 'us', 'events', false)
	expect(after.tabs.value.map((tab) => tab.id)).toEqual(['audit::us::events'])
})

it('keeps the tabs when the selected database is unknown', () => {
	setup()
	storing({
		database: 'warehouse',
		tabs: [{ schema: 'sales', instance: 'eu', table: 'orders' }],
		activeId: null,
	})
	const browser = useDataBrowserTabs()
	browser.restore(undefined)
	expect(browser.tabs.value.map((tab) => tab.id)).toEqual(['sales::eu::orders'])
	browser.openTab('audit', 'us', 'events', false)
	const reloaded = useDataBrowserTabs()
	reloaded.restore('warehouse')
	expect(reloaded.tabs.value.map((tab) => tab.id)).toEqual([
		'sales::eu::orders',
		'audit::us::events',
	])
})

it('retains usable tabs when session storage is unavailable', () => {
	setup()
	const deny = () => {
		throw new Error('Storage denied')
	}
	vi.stubGlobal('window', { sessionStorage: { getItem: deny, setItem: deny } })
	const browser = useDataBrowserTabs()
	browser.restore('own')
	browser.openTab('sales', 'eu', 'orders', false)
	expect(browser.activeId.value).toBe('sales::eu::orders')
})

it('does not revisit an already selected deep link while restoring tabs', () => {
	setup()
	const replace = vi.fn()
	vi.stubGlobal('useDmsRouter', () => ({ replace }))
	vi.stubGlobal('useDmsRoute', () => ({
		query: {
			schema: 'sales',
			table: 'orders',
			instance: 'eu',
			panel: 'detail',
		},
	}))
	const browser = useDataBrowserTabs()
	browser.restore('own')
	expect(browser.activeId.value).toBe('sales::eu::orders')
	expect(replace).not.toHaveBeenCalled()
	browser.openTab('sales', 'us', 'orders', false)
	expect(replace).toHaveBeenCalledExactlyOnceWith({
		query: {
			schema: 'sales',
			table: 'orders',
			instance: 'us',
			panel: 'detail',
		},
	})
})

it('restores the preview tab as a preview, the URL naming it included', () => {
	setup()
	const replace = vi.fn()
	vi.stubGlobal('useDmsRouter', () => ({ replace }))
	vi.stubGlobal('useDmsRoute', () => ({
		query: { schema: 'sales', table: 'orders', instance: 'eu' },
	}))
	vi.stubGlobal('window', {
		sessionStorage: {
			getItem: () =>
				JSON.stringify({
					database: 'own',
					tabs: [
						{ schema: 'sales', instance: 'eu', table: 'customers' },
						{
							schema: 'sales',
							instance: 'eu',
							table: 'orders',
							preview: true,
						},
					],
					activeId: 'sales::eu::orders',
				}),
			setItem: vi.fn(),
		},
	})
	const browser = useDataBrowserTabs()
	browser.restore('own')
	expect(browser.activeId.value).toBe('sales::eu::orders')
	expect(browser.tabs.value.map((tab) => tab.preview)).toEqual([false, true])
	expect(replace).not.toHaveBeenCalled()
})

describe('data browser: the route it writes itself', () => {
	// A reactive route the router writes to, as the DMS's stable
	// useDmsRoute() reflects a landed visit.
	function routed(query: Record<string, string> = {}) {
		setup()
		vi.stubGlobal('window', {
			sessionStorage: { getItem: () => null, setItem: vi.fn() },
		})
		const route = reactive({ query })
		const replace = vi.fn(({ query: next }: { query: typeof query }) => {
			route.query = next
		})
		vi.stubGlobal('useDmsRoute', () => route)
		vi.stubGlobal('useDmsRouter', () => ({ replace }))
		return { route, replace, browser: useDataBrowserTabs() }
	}

	it('keeps a preview tab a preview once its URL lands', () => {
		const { route, replace, browser } = routed()
		browser.openTab('sales', 'eu', 'orders')
		expect(replace).toHaveBeenCalledExactlyOnceWith({
			query: { schema: 'sales', table: 'orders', instance: 'eu' },
		})
		// The page's route watcher sees the URL the browser wrote.
		expect(route.query.table).toBe('orders')
		expect(browser.openFromRoute()).toBe(true)
		expect(browser.tabs.value).toEqual([
			expect.objectContaining({ id: 'sales::eu::orders', preview: true }),
		])
	})

	it('opens a linked table pinned, the preview slot left alone', () => {
		const { route, browser } = routed()
		browser.openTab('sales', 'eu', 'orders')
		route.query = { schema: 'sales', table: 'customers', instance: 'eu' }
		browser.openFromRoute()
		expect(browser.activeId.value).toBe('sales::eu::customers')
		expect(browser.tabs.value.map((tab) => [tab.id, tab.preview])).toEqual([
			['sales::eu::orders', true],
			['sales::eu::customers', false],
		])
	})

	it('pins the active preview tab when a link filters it on a row', () => {
		const { route, browser } = routed()
		browser.openTab('sales', 'eu', 'orders')
		route.query = {
			schema: 'sales',
			table: 'orders',
			instance: 'eu',
			match: '_id:42',
		}
		browser.openFromRoute()
		expect(browser.tabs.value).toEqual([
			expect.objectContaining({ id: 'sales::eu::orders', preview: false }),
		])
	})
})
