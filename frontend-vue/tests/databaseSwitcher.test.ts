import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import {
	hasUnsavedChanges,
	registerUnsavedChanges,
	resetUnsavedChanges,
} from '#dms-ui/app/build/composables/unsaved-changes/registry'
import {
	browserMount,
	isPropHandler,
	menuLocks,
	propText,
	type BackendRead,
	type BrowserMount,
	type MountProps,
	type MountValue,
} from './fixtures/serverRender'
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

/** The popover with its `content` slot drawn, which the library's stub leaves out. */
const PopoverStub = defineComponent({
	setup:
		(_, { slots }) =>
		() =>
			h('div', { 'data-stub': 'UPopover' }, [
				slots.default?.(),
				slots.content?.(),
			]),
})

type Mounted = BrowserMount

const rowOf = (page: Mounted, id: string): MountProps | undefined =>
	page.find((props) => props['data-database-option'] === id)

/** What picking a row does: the handler of its button. */
function pickRow(page: Mounted, id: string): void {
	const click = rowOf(page, id)?.onClick
	if (!isPropHandler(click)) throw new Error(`no row for ${id}`)
	click()
}

const connectEntry = (page: Mounted): MountProps | undefined =>
	page.find((props) => props.icon === 'i-ph-plus')

async function mountSwitcher(
	backend = connectionsBackend(connectionsState(OWN)),
	props: Record<string, MountValue> = {},
	provide: [symbol, unknown][] = [],
) {
	const page = browserMount(DatabaseSwitcher, backend, props, {
		provide,
		components: { UPopover: PopoverStub },
	})
	await page.shown
	await vi.waitFor(() => expect(page.reads).not.toHaveLength(0))
	await new Promise((resolve) => setTimeout(resolve, 0))
	return { page }
}

type Listener = () => void

const PAGE_PATH = '/modules/database/data'

/** A window and a document that record what the page listens for, and the reloads and navigations it makes. */
function stubBrowser(visibility: 'visible' | 'hidden' = 'visible') {
	const assign = vi.fn()
	const removeItem = vi.fn()
	const listeners = new Map<string, Listener[]>()
	const target = {
		addEventListener: (type: string, listener: Listener) =>
			listeners.set(type, [...(listeners.get(type) ?? []), listener]),
		removeEventListener: vi.fn(),
	}
	vi.stubGlobal('window', {
		...target,
		location: { assign, pathname: PAGE_PATH },
		sessionStorage: { removeItem },
	})
	vi.stubGlobal('document', { ...target, visibilityState: visibility })
	return {
		assign,
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
		const { page } = await mountSwitcher()
		expect(page.text()).toContain('dms_database.connections.own')
		expect(page.text()).toContain('Warehouse')
		expect(page.text()).not.toContain('legacy-label')
		expect(page.errors).toEqual([])
	})

	it('gives each database a row of its own, in the order the API lists them', async () => {
		const { page } = await mountSwitcher()
		expect(rowOf(page, 'own')).toBeDefined()
		expect(rowOf(page, 'warehouse')).toBeDefined()
		expect(rowOf(page, 'nope')).toBeUndefined()
	})

	it('shows the engine of each database under its name, and the project database the locale subtitle when the catalog names none', async () => {
		const { page } = await mountSwitcher(
			connectionsBackend(
				connectionsState(OWN, {
					connections: [{ ...OWN, engine: null }, WAREHOUSE],
				}),
			),
		)
		expect(page.text()).toContain('postgres')
		expect(page.text()).toContain(
			'dms_database.connections.switcher.own_subtitle',
		)
	})

	it('badges an external database as External, in the list and on the trigger, and the project database with none, which a badge on every row gets wrong', async () => {
		const { page } = await mountSwitcher(
			connectionsBackend(connectionsState(WAREHOUSE)),
		)
		const external = 'UBadge" label="dms_database.connections.external"'
		expect(page.text().split(external)).toHaveLength(3)
		expect(page.text()).not.toContain('color="neutral"')
		const own = await mountSwitcher()
		expect(own.page.text().split(external)).toHaveLength(2)
	})

	it('shows the access in the subtitle as an icon and a text, never in a badge', async () => {
		const { page } = await mountSwitcher()
		expect(page.text()).toContain('i-ph-lock-simple')
		expect(page.text()).toContain(
			'dms_database.connections.switcher.access_read',
		)
		expect(page.text()).not.toContain(
			'label="dms_database.connections.switcher.access_read"',
		)
		expect(page.text()).not.toContain('i-ph-pencil-simple')
	})

	it('shows an external database that may be written as Read & write', async () => {
		const writable = { ...WAREHOUSE, access: 'read-write' as const }
		const { page } = await mountSwitcher(
			connectionsBackend(
				connectionsState(OWN, { connections: [OWN, writable] }),
			),
		)
		expect(page.text()).toContain('i-ph-pencil-simple')
		expect(page.text()).toContain(
			'dms_database.connections.switcher.access_read_write',
		)
		expect(page.text()).not.toContain('i-ph-lock-simple')
	})

	it('marks the selected database as current, which a list that always marks the first gets wrong', async () => {
		const { page } = await mountSwitcher(
			connectionsBackend(connectionsState(WAREHOUSE)),
		)
		expect(rowOf(page, 'own')?.['aria-current']).toBeUndefined()
		expect(rowOf(page, 'warehouse')?.['aria-current']).toBe('true')
		expect(page.text()).toContain('i-ph-check')
	})

	it('shows only the icon on the collapsed rail, and the name beside it otherwise', async () => {
		const expanded = await mountSwitcher()
		expect(
			expanded.page.find((props) => 'data-database-trigger-name' in props),
		).toBeDefined()
		const collapsed = await mountSwitcher(undefined, { collapsed: true })
		expect(
			collapsed.page.find((props) => 'data-database-trigger-name' in props),
		).toBeUndefined()
		expect(
			collapsed.page.find(
				(props) =>
					props['aria-label'] ===
					'dms_database.connections.switcher.label: dms_database.connections.own',
			),
		).toBeDefined()
	})

	it('shows nothing while no database is listed', async () => {
		const { page } = await mountSwitcher(
			connectionsBackend(connectionsState(OWN, { connections: [] })),
		)
		expect(page.text()).not.toContain('data-database-switcher')
	})
})

describe('database switcher: a database the project did not fully register', () => {
	const SHOP: DatabaseConnection = {
		...WAREHOUSE,
		id: 'shop',
		label: 'shop',
		missing: ['database'],
	}

	it('lists it as a row that cannot be picked, with the reason and the Not registered badge, which a list leaving it out gets wrong', async () => {
		const { page } = await mountSwitcher(
			connectionsBackend(connectionsState(OWN, { connections: [OWN, SHOP] })),
		)
		const row = rowOf(page, 'shop')
		expect(row?.disabled).toBe(true)
		expect(propText(row?.title)).toContain('unregistered_hint')
		expect(propText(row?.title)).toContain('missing_database')
		expect(page.text()).toContain(
			'label="dms_database.connections.switcher.unregistered"',
		)
		expect(page.text()).not.toContain('access_read')
		expect(page.text()).not.toContain(
			'UBadge" label="dms_database.connections.external',
		)
	})

	it('stores nothing when its row is activated anyway, which an implementation that relies on the disabled attribute alone gets wrong', async () => {
		const { page } = await mountSwitcher(
			connectionsBackend(connectionsState(OWN, { connections: [OWN, SHOP] })),
		)
		expect(rowOf(page, 'own')?.disabled).toBe(false)
		pickRow(page, 'shop')
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(connectionWrites(page.reads)).toEqual([])
		expect(browser.assign).not.toHaveBeenCalled()
	})
})

describe('database switcher: connect a database', () => {
	const CONNECT = 'dms_database.connections.switcher.connect'

	it('hides the entry when dms-assistant provides nothing', async () => {
		const { page } = await mountSwitcher()
		expect(connectEntry(page)).toBeUndefined()
		expect(page.text()).not.toContain(CONNECT)
	})

	it('hides the entry while the assistant is not available', async () => {
		const { page } = await mountSwitcher(undefined, {}, [
			[ONBOARDING, { isAvailable: false, open: vi.fn() }],
		])
		expect(connectEntry(page)).toBeUndefined()
	})

	it('opens the connect step of the assistant when the entry is picked', async () => {
		const open = vi.fn()
		const { page } = await mountSwitcher(undefined, {}, [
			[ONBOARDING, { isAvailable: true, open }],
		])
		const click = connectEntry(page)?.onClick
		expect(click).toBeTypeOf('function')
		if (isPropHandler(click)) click()
		expect(open).toHaveBeenCalledExactlyOnceWith('connect-database')
	})
})

describe('database switcher: picking a database', () => {
	it('stores the choice, drops the tabs of the database left, and reads the page again', async () => {
		const { page } = await mountSwitcher(
			connectionsBackend(connectionsState(OWN), {
				answer: () => connectionsState(WAREHOUSE),
			}),
		)
		pickRow(page, 'warehouse')
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
		const { page } = await mountSwitcher(
			connectionsBackend(connectionsState(OWN), {
				answer: () => {
					throw new Error('refused')
				},
			}),
		)
		pickRow(page, 'warehouse')
		await vi.waitFor(() => expect(connectionWrites(page.reads)).toHaveLength(1))
		await Promise.resolve()
		expect(browser.assign).not.toHaveBeenCalled()
		expect(browser.removeItem).not.toHaveBeenCalled()
	})

	it('does nothing when the selected database is picked again', async () => {
		const { page } = await mountSwitcher()
		pickRow(page, 'own')
		await Promise.resolve()
		expect(connectionWrites(page.reads)).toEqual([])
		expect(browser.assign).not.toHaveBeenCalled()
	})

	it('stores nothing and stays when the user declines to lose unsaved edits, which an implementation that stores first and leaves on the browser prompt gets wrong', async () => {
		const prompt = vi.fn(async () => false)
		registerUnsavedChanges({ isDirty: () => true }, prompt)
		const { page } = await mountSwitcher(
			connectionsBackend(connectionsState(OWN), {
				answer: () => connectionsState(WAREHOUSE),
			}),
		)
		pickRow(page, 'warehouse')
		await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(connectionWrites(page.reads)).toEqual([])
		expect(browser.assign).not.toHaveBeenCalled()
		expect(browser.removeItem).not.toHaveBeenCalled()
	})

	it('stores the choice and reloads without asking again once the user accepts to lose them', async () => {
		registerUnsavedChanges({ isDirty: () => true }, async () => true)
		const { page } = await mountSwitcher(
			connectionsBackend(connectionsState(OWN), {
				answer: () => connectionsState(WAREHOUSE),
			}),
		)
		pickRow(page, 'warehouse')
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

	it('reloads the page without its query when the window regains focus on another selection, which an implementation that only reads at load, or reloads the table the URL names, gets wrong', async () => {
		const server = serverSelecting(OWN)
		await mountWithServer(server)
		server.select(WAREHOUSE)
		browser.fire('focus')
		await vi.waitFor(() =>
			expect(browser.assign).toHaveBeenCalledExactlyOnceWith(PAGE_PATH),
		)
		expect(browser.removeItem).toHaveBeenCalled()
	})

	it('reloads when the page becomes visible on another selection', async () => {
		const server = serverSelecting(OWN)
		await mountWithServer(server)
		server.select(WAREHOUSE)
		browser.fire('visibilitychange')
		await vi.waitFor(() =>
			expect(browser.assign).toHaveBeenCalledExactlyOnceWith(PAGE_PATH),
		)
	})

	it('does not reload when the selection is the one the page loaded with, which an implementation that reloads on every focus gets wrong', async () => {
		const server = serverSelecting(OWN)
		const { page } = await mountWithServer(server)
		const before = page.reads.length
		browser.fire('focus')
		await vi.waitFor(() => expect(page.reads.length).toBeGreaterThan(before))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(browser.assign).not.toHaveBeenCalled()
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

	it('locks the Query console entry and leaves the Diagram open while an external database is selected, which a switcher leaving the sidebar open gets wrong', async () => {
		await mountSwitcher(connectionsBackend(connectionsState(WAREHOUSE)))
		expect(lockedIds()).toEqual(['page/modules/database/query'])
		expect(menuLocks.value.map((entry) => entry.reason)).toEqual([
			'$dms_database.connections.locked.reason',
		])
	})

	it('unlocks them for the project database, which a lock left from the last selection gets wrong', async () => {
		await mountSwitcher(connectionsBackend(connectionsState(WAREHOUSE)))
		await mountSwitcher(connectionsBackend(connectionsState(OWN)))
		expect(lockedIds()).toEqual([])
	})
})
