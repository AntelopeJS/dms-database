import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import {
	hasUnsavedChanges,
	registerUnsavedChanges,
	resetUnsavedChanges,
} from '#dms-ui/app/build/composables/unsaved-changes/registry'
import { browserMount, menuLocks } from './fixtures/serverRender'
import type { BackendRead } from './fixtures/serverRender'
import {
	CONNECTIONS_URL,
	OWN,
	WAREHOUSE,
	connectionWrites,
	connectionsBackend,
	connectionsState,
} from './fixtures/connections'
import type { DatabaseConnection } from '../app/build/composables/useDatabaseConnections'
import DatabaseSwitcher from '../app/components/DatabaseSwitcher.vue'
import {
	DATABASE_SWITCHER_WIDGET,
	registerDatabaseSwitcher,
} from '../app/build/composables/registerDatabaseSwitcher'

const ONBOARDING = Symbol.for('dms-assistant:onboarding')
const MENU = (props: Record<string, unknown>) =>
	props['data-stub'] === 'UDropdownMenu'

interface MenuItem {
	label?: string
	description?: string
	external?: boolean
	checked?: boolean
	onSelect?: () => void
}

/** The menu with the `item-trailing` slot of each item drawn, which the stub of the library leaves out. */
const MenuStub = defineComponent({
	props: { items: { type: Array, default: () => [] } },
	setup:
		(props, { slots }) =>
		() =>
			h('div', { 'data-stub': 'UDropdownMenu', items: props.items }, [
				slots.default?.(),
				...props.items
					.flat()
					.map((item) => h('div', {}, slots['item-trailing']?.({ item }))),
			]),
})

async function mountSwitcher(
	backend = connectionsBackend(connectionsState(OWN)),
	props: Record<string, unknown> = {},
	provide: [symbol, unknown][] = [],
) {
	const page = browserMount(DatabaseSwitcher, backend, props, {
		provide,
		components: { UDropdownMenu: MenuStub },
	})
	await page.shown
	await vi.waitFor(() => expect(page.reads).not.toHaveLength(0))
	await new Promise((resolve) => setTimeout(resolve, 0))
	const groups = page.find(MENU)?.items
	const items: MenuItem[] = Array.isArray(groups) ? groups.flat() : []
	return { page, items }
}

type Listener = () => void

/** A window and a document that record what the page listens for, and the reloads and navigations it makes. */
function stubBrowser(visibility: 'visible' | 'hidden' = 'visible') {
	const assign = vi.fn()
	const reload = vi.fn()
	const removeItem = vi.fn()
	const listeners = new Map<string, Listener[]>()
	const target = {
		addEventListener: (type: string, listener: Listener) =>
			listeners.set(type, [...(listeners.get(type) ?? []), listener]),
		removeEventListener: vi.fn(),
	}
	vi.stubGlobal('window', {
		...target,
		location: { assign, reload },
		sessionStorage: { removeItem },
	})
	vi.stubGlobal('document', { ...target, visibilityState: visibility })
	return {
		assign,
		reload,
		removeItem,
		fire: (type: string) => {
			for (const listener of listeners.get(type) ?? []) listener()
		},
	}
}

let browser = stubBrowser()

beforeEach(() => {
	browser = stubBrowser()
})

afterEach(() => {
	vi.stubGlobal('window', undefined)
	vi.stubGlobal('document', undefined)
	resetUnsavedChanges()
})

describe('database switcher menu', () => {
	it('names the project database from the locale, which an implementation showing its API label gets wrong', async () => {
		const { items, page } = await mountSwitcher()
		expect(items.map((item) => item.label)).toEqual([
			'dms_database.connections.own',
			'Warehouse',
		])
		expect(page.text()).not.toContain('legacy-label')
		expect(page.errors).toEqual([])
	})

	it('gives an external database its engine and the External badge, and the project database neither', async () => {
		const { items, page } = await mountSwitcher()
		expect(items.map((item) => item.description)).toEqual([
			'mongodb',
			'postgres',
		])
		expect(items.map((item) => item.external)).toEqual([false, true])
		const badges = page.text().match(/dms_database\.connections\.external/g)
		expect(badges).toHaveLength(1)
	})

	it('checks the selected database, which a menu that always checks the first gets wrong', async () => {
		const { items } = await mountSwitcher(
			connectionsBackend(connectionsState(WAREHOUSE)),
		)
		expect(items.map((item) => item.checked)).toEqual([false, true])
	})

	it('shows only the icon on the collapsed rail, and the name beside it otherwise', async () => {
		const expanded = await mountSwitcher()
		expect(expanded.page.text()).toContain(
			'label="dms_database.connections.own"',
		)
		const collapsed = await mountSwitcher(undefined, { collapsed: true })
		expect(collapsed.page.text()).not.toContain(
			'label="dms_database.connections.own"',
		)
		expect(collapsed.page.text()).toContain('aria-label="')
	})

	it('shows nothing while no database is listed', async () => {
		const { page } = await mountSwitcher(
			connectionsBackend(connectionsState(OWN, { connections: [] })),
		)
		expect(page.text()).not.toContain('data-database-switcher')
	})
})

describe('database switcher: connect a database', () => {
	const CONNECT = 'dms_database.connections.switcher.connect'

	it('hides the entry when dms-assistant provides nothing', async () => {
		const { items } = await mountSwitcher()
		expect(items.map((item) => item.label)).not.toContain(CONNECT)
	})

	it('hides the entry while the assistant is not available', async () => {
		const { items } = await mountSwitcher(undefined, {}, [
			[ONBOARDING, { isAvailable: false, open: vi.fn() }],
		])
		expect(items.map((item) => item.label)).not.toContain(CONNECT)
	})

	it('opens the connect step of the assistant when the entry is picked', async () => {
		const open = vi.fn()
		const { items } = await mountSwitcher(undefined, {}, [
			[ONBOARDING, { isAvailable: true, open }],
		])
		const entry = items.find((item) => item.label === CONNECT)
		expect(entry).toBeDefined()
		entry?.onSelect?.()
		expect(open).toHaveBeenCalledExactlyOnceWith('connect-database')
	})
})

describe('database switcher: picking a database', () => {
	it('stores the choice, drops the tabs of the database left, and reads the page again', async () => {
		const { items, page } = await mountSwitcher(
			connectionsBackend(connectionsState(OWN), {
				answer: () => connectionsState(WAREHOUSE),
			}),
		)
		items.find((item) => item.label === 'Warehouse')?.onSelect?.()
		await vi.waitFor(() => expect(browser.assign).toHaveBeenCalledOnce())
		expect(connectionWrites(page.reads)).toEqual([
			{
				method: 'PUT',
				url: '/api/database/connections/selected',
				body: { connection: 'warehouse' },
			},
		])
		expect(browser.removeItem).toHaveBeenCalledOnce()
		expect(browser.assign.mock.calls[0]?.[0]).toEqual(expect.any(String))
		expect(String(browser.assign.mock.calls[0]?.[0])).not.toContain('?')
	})

	it('stays on the page when the server refuses the choice', async () => {
		const { items, page } = await mountSwitcher(
			connectionsBackend(connectionsState(OWN), {
				answer: () => {
					throw new Error('refused')
				},
			}),
		)
		items.find((item) => item.label === 'Warehouse')?.onSelect?.()
		await vi.waitFor(() => expect(connectionWrites(page.reads)).toHaveLength(1))
		await Promise.resolve()
		expect(browser.assign).not.toHaveBeenCalled()
		expect(browser.removeItem).not.toHaveBeenCalled()
	})

	it('does nothing when the selected database is picked again', async () => {
		const { items, page } = await mountSwitcher()
		items
			.find((item) => item.label === 'dms_database.connections.own')
			?.onSelect?.()
		await Promise.resolve()
		expect(connectionWrites(page.reads)).toEqual([])
		expect(browser.assign).not.toHaveBeenCalled()
	})

	it('stores nothing and stays when the user declines to lose unsaved edits, which an implementation that stores first and leaves on the browser prompt gets wrong', async () => {
		const prompt = vi.fn(async () => false)
		registerUnsavedChanges({ isDirty: () => true }, prompt)
		const { items, page } = await mountSwitcher(
			connectionsBackend(connectionsState(OWN), {
				answer: () => connectionsState(WAREHOUSE),
			}),
		)
		items.find((item) => item.label === 'Warehouse')?.onSelect?.()
		await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(connectionWrites(page.reads)).toEqual([])
		expect(browser.assign).not.toHaveBeenCalled()
		expect(browser.removeItem).not.toHaveBeenCalled()
	})

	it('stores the choice and reloads without asking again once the user accepts to lose them', async () => {
		registerUnsavedChanges({ isDirty: () => true }, async () => true)
		const { items, page } = await mountSwitcher(
			connectionsBackend(connectionsState(OWN), {
				answer: () => connectionsState(WAREHOUSE),
			}),
		)
		items.find((item) => item.label === 'Warehouse')?.onSelect?.()
		await vi.waitFor(() => expect(browser.assign).toHaveBeenCalledOnce())
		expect(connectionWrites(page.reads)).toHaveLength(1)
		expect(hasUnsavedChanges()).toBe(false)
	})
})

describe('database switcher: another tab switched the database', () => {
	function serverSelecting(selected: DatabaseConnection) {
		let state = connectionsState(selected)
		return {
			select: (next: DatabaseConnection) => {
				state = connectionsState(next)
			},
			answers: (read: BackendRead) =>
				read.url === CONNECTIONS_URL ? state : {},
		}
	}

	const mountWithServer = (server: ReturnType<typeof serverSelecting>) =>
		mountSwitcher(server.answers)

	it('reloads when the window regains focus on another selection, which an implementation that only reads at load gets wrong', async () => {
		const server = serverSelecting(OWN)
		await mountWithServer(server)
		server.select(WAREHOUSE)
		browser.fire('focus')
		await vi.waitFor(() => expect(browser.reload).toHaveBeenCalledOnce())
		expect(browser.removeItem).toHaveBeenCalled()
	})

	it('reloads when the page becomes visible on another selection', async () => {
		const server = serverSelecting(OWN)
		await mountWithServer(server)
		server.select(WAREHOUSE)
		browser.fire('visibilitychange')
		await vi.waitFor(() => expect(browser.reload).toHaveBeenCalledOnce())
	})

	it('does not reload when the selection is the one the page loaded with, which an implementation that reloads on every focus gets wrong', async () => {
		const server = serverSelecting(OWN)
		const { page } = await mountWithServer(server)
		const before = page.reads.length
		browser.fire('focus')
		await vi.waitFor(() => expect(page.reads.length).toBeGreaterThan(before))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(browser.reload).not.toHaveBeenCalled()
	})
})

describe('database switcher widget', () => {
	it('registers the switcher under the module title, at the top of its sidebar, by the name the module registers it under', () => {
		const register = vi.fn()
		vi.stubGlobal('useSidebarWidgets', () => ({ register }))
		registerDatabaseSwitcher()
		expect(register).toHaveBeenCalledExactlyOnceWith(DATABASE_SWITCHER_WIDGET)
		expect(DATABASE_SWITCHER_WIDGET).toMatchObject({
			module: 'database',
			position: 'below-search-bar',
			component: 'DmsDatabaseDatabaseSwitcher',
		})
		expect(DATABASE_SWITCHER_WIDGET.order).toBeLessThan(0)
	})
})

describe('database switcher: locked pages', () => {
	const lockedIds = () => menuLocks.value.map((entry) => entry.fullId).sort()

	it('locks the Diagram and Query console entries while an external database is selected, which a switcher leaving the sidebar open gets wrong', async () => {
		await mountSwitcher(connectionsBackend(connectionsState(WAREHOUSE)))
		expect(lockedIds()).toEqual([
			'page/modules/database/diagram',
			'page/modules/database/query',
		])
		expect(menuLocks.value.map((entry) => entry.reason)).toEqual([
			'$dms_database.connections.locked.reason',
			'$dms_database.connections.locked.reason',
		])
	})

	it('unlocks them for the project database, which a lock left from the last selection gets wrong', async () => {
		await mountSwitcher(connectionsBackend(connectionsState(WAREHOUSE)))
		await mountSwitcher(connectionsBackend(connectionsState(OWN)))
		expect(lockedIds()).toEqual([])
	})
})
