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
					tabs: [{ schema: 'sales', instance: 'eu', table: 'orders' }],
					activeId: null,
				}),
			setItem,
		},
	})
	const browser = useDataBrowserTabs()
	browser.restore()
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

it('retains usable tabs when session storage is unavailable', () => {
	setup()
	const deny = () => {
		throw new Error('Storage denied')
	}
	vi.stubGlobal('window', { sessionStorage: { getItem: deny, setItem: deny } })
	const browser = useDataBrowserTabs()
	browser.restore()
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
	browser.restore()
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
	browser.restore()
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
