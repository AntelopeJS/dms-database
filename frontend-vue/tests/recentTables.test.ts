import { afterEach, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { freshState } from './fixtures/dmsState'
import { useDataBrowserTabs } from '../app/build/composables/useDataBrowserTabs'

afterEach(() => vi.unstubAllGlobals())

/** A browser whose session and local storage keep what the page writes. */
function browsing() {
	const storage = () => {
		const items = new Map<string, string>()
		return {
			getItem: (key: string) => items.get(key) ?? null,
			setItem: (key: string, value: string) => void items.set(key, value),
			removeItem: (key: string) => void items.delete(key),
		}
	}
	vi.stubGlobal('useDmsState', freshState)
	vi.stubGlobal('computed', computed)
	vi.stubGlobal('useDmsRoute', () => ({ query: {} }))
	vi.stubGlobal('useDmsRouter', () => ({ replace: vi.fn() }))
	vi.stubGlobal('useDataBrowserGrid', () => ({ drop: vi.fn() }))
	vi.stubGlobal('window', {
		sessionStorage: storage(),
		localStorage: storage(),
	})
}

/** The tables the empty state offers, as `schema.table`. */
function offered(browser: ReturnType<typeof useDataBrowserTabs>): string[] {
	return browser.recent.value.map((entry) => `${entry.schema}.${entry.table}`)
}

it('P2: after follow drops the old database tabs, the empty state offers none of its tables', () => {
	browsing()
	const browser = useDataBrowserTabs()
	browser.restore('own')
	browser.openTab('shop', 'eu', 'orders', false)
	browser.closeTab('shop::eu::orders')
	expect(offered(browser)).toEqual(['shop.orders'])
	browser.follow('warehouse')
	expect(offered(browser)).toEqual([])
	browser.openTab('public', '__DEFAULT__', 'invoices', false)
	expect(offered(browser)).toEqual(['public.invoices'])
})

it('offers on a reload only the tables of the selected database, and those of the previous one once it is selected again, which one list for every database gets wrong', () => {
	browsing()
	const before = useDataBrowserTabs()
	before.restore('own')
	before.openTab('shop', 'eu', 'orders', false)
	const switched = useDataBrowserTabs()
	switched.restore('warehouse')
	expect(offered(switched)).toEqual([])
	switched.openTab('public', '__DEFAULT__', 'invoices', false)
	const back = useDataBrowserTabs()
	back.restore('own')
	expect(offered(back)).toEqual(['shop.orders'])
})

it('offers no table while no database is known, which tables remembered under no database get wrong', () => {
	browsing()
	const browser = useDataBrowserTabs()
	browser.restore(undefined)
	browser.openTab('shop', 'eu', 'orders', false)
	expect(offered(browser)).toEqual([])
	browser.follow('warehouse')
	expect(offered(browser)).toEqual([])
})
