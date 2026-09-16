import { afterEach, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useDataBrowserTabs } from '../app/composables/useDataBrowserTabs'

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
		query: { schema: 'sales', table: 'orders', instance: 'eu', panel: 'detail' },
	}))
	const browser = useDataBrowserTabs()
	browser.restore()
	expect(browser.activeId.value).toBe('sales::eu::orders')
	expect(replace).not.toHaveBeenCalled()
	browser.openTab('sales', 'us', 'orders', false)
	expect(replace).toHaveBeenCalledExactlyOnceWith({
		query: { schema: 'sales', table: 'orders', instance: 'us', panel: 'detail' },
	})
})
