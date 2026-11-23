import { isObject, isText } from '../utils/values'
import type { ComputedRef, Ref } from 'vue'
import type { InstanceChoice } from '../data/instanceOptions'
import {
	type RecentTable,
	readRecentTables,
	rememberTable,
} from '../data/recentTables'
import { useStagedEdits } from '../data/stagedEdits'
import {
	decodeMatch,
	instanceFromUrl,
	instanceToUrl,
} from '../utils/databaseLinks'
import { CROSS_INSTANCE_VALUE, DEFAULT_INSTANCE_VALUE } from './browserInstance'
import { useDataBrowserGrid } from './useDataBrowserGrid'

export { CROSS_INSTANCE_VALUE, DEFAULT_INSTANCE_VALUE }

/**
 * A tab's instance as a choice ("all": read-only), as pickers and the URL
 * (see instanceFromUrl) carry it.
 */
export function instanceChoiceOf(instance: string): InstanceChoice {
	if (instance === DEFAULT_INSTANCE_VALUE) return { kind: 'default' }
	if (instance === CROSS_INSTANCE_VALUE) return { kind: 'all' }
	return { kind: 'named', id: instance }
}

/** The tab instance a choice stands for. */
export function tabInstanceOf(choice: InstanceChoice): string {
	if (choice.kind === 'default') return DEFAULT_INSTANCE_VALUE
	if (choice.kind === 'all') return CROSS_INSTANCE_VALUE
	return choice.id
}

/** How a tab names its instance: null for the default one, "@eu", "@all". */
export function instanceBadge(
	instance: string,
	allLabel: string,
): string | null {
	if (instance === DEFAULT_INSTANCE_VALUE) return null
	return `@${instance === CROSS_INSTANCE_VALUE ? allLabel : instance}`
}

export interface BrowserTab {
	id: string
	schema: string
	/** DEFAULT_INSTANCE_VALUE, CROSS_INSTANCE_VALUE or a named instance id. */
	instance: string
	table: string
	/**
	 * VS Code-style preview tab: the next openTab reuses it instead of adding
	 * a new tab. At most one per session; pinning (double-click, pin icon,
	 * drag-reorder, editing a cell) clears the flag.
	 */
	preview?: boolean
}

const STORAGE_KEY = 'dms-database:data-browser:tabs'
const DATABASE_STATE = 'dms-database-browser-database'
const ACTIVATIONS_STATE = 'dms-database-browser-activations'
const RECENT_STATE = 'dms-database-browser-recent'

function browserTabId(schema: string, instance: string, table: string): string {
	return `${schema}::${instance}::${table}`
}

/**
 * Drops the tabs this browser tab kept: they name tables of the database
 * that was browsed, which the next one may not hold.
 */
export function forgetBrowserTabs(): void {
	if (typeof window === 'undefined') return
	window.sessionStorage.removeItem(STORAGE_KEY)
}

interface PersistedTabs {
	/**
	 * The connection the tabs were opened on: another one may not hold their
	 * tables. Null when they were opened while the selection was unknown.
	 */
	database: string | null
	tabs: BrowserTab[]
	activeId: string | null
}

interface StoredTab {
	schema: string
	instance: string
	table: string
	preview?: unknown
}

interface StoredTabs {
	database: string | null
	tabs: unknown[]
	activeId?: unknown
}

/** Whether a stored value names the table of a tab. */
function isStoredTab(value: unknown): value is StoredTab {
	return (
		isObject(value) &&
		'schema' in value &&
		isText(value.schema) &&
		'instance' in value &&
		isText(value.instance) &&
		'table' in value &&
		isText(value.table)
	)
}

/** Whether a stored value is a list of tabs with the database they were opened on. */
function isStoredTabs(value: unknown): value is StoredTabs {
	return (
		isObject(value) &&
		'database' in value &&
		(value.database === null || isText(value.database)) &&
		'tabs' in value &&
		Array.isArray(value.tabs)
	)
}

/** The tabs this browser tab kept, with the database they were opened on. */
function readPersisted(): PersistedTabs | null {
	if (typeof window === 'undefined') return null
	try {
		const raw = window.sessionStorage.getItem(STORAGE_KEY)
		if (!raw) return null
		const parsed: unknown = JSON.parse(raw)
		if (!isStoredTabs(parsed)) return null
		const tabs = parsed.tabs
			.filter(isStoredTab)
			.map((tab) => ({
				...tab,
				id: browserTabId(tab.schema, tab.instance, tab.table),
				preview: tab.preview === true,
			}))
			.filter(
				(tab, index, all) => all.findIndex((t) => t.id === tab.id) === index,
			)
		const firstPreview = tabs.findIndex((tab) => tab.preview)
		for (const [index, tab] of tabs.entries()) {
			if (index !== firstPreview) tab.preview = false
		}
		const activeId =
			tabs.find((tab) => tab.id === parsed.activeId)?.id ?? tabs[0]?.id ?? null
		return { database: parsed.database, tabs, activeId }
	} catch {
		return null
	}
}

interface TabsState {
	tabs: Ref<BrowserTab[]>
	activeId: Ref<string | null>
	activations: Ref<number>
	database: Ref<string | null>
	recent: Ref<RecentTable[]>
	activeTab: ComputedRef<BrowserTab | null>
}

function useTabsState(): TabsState {
	const tabs = useDmsState<BrowserTab[]>('dms-database-browser-tabs', () => [])
	const activeId = useDmsState<string | null>(
		'dms-database-browser-active',
		() => null,
	)
	const activations = useDmsState<number>(ACTIVATIONS_STATE, () => 0)
	const database = useDmsState<string | null>(DATABASE_STATE, () => null)
	const recent = useDmsState<RecentTable[]>(RECENT_STATE, () => [])
	const activeTab = computed(
		() => tabs.value.find((tab) => tab.id === activeId.value) ?? null,
	)
	return { tabs, activeId, activations, database, recent, activeTab }
}

/** Stores the open tabs for this browser tab's session. A full or private storage only loses the restore. */
function persistTabs({ database, tabs, activeId }: TabsState) {
	if (typeof window === 'undefined') return
	try {
		window.sessionStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				database: database.value,
				tabs: tabs.value,
				activeId: activeId.value,
			}),
		)
	} catch {}
}

/**
 * The URL carries the active tab only (deep-links); per-tab grid state
 * deliberately stays out of it.
 */
function createTabsUrl(
	{ activeTab }: TabsState,
	route: ReturnType<typeof useDmsRoute>,
	router: ReturnType<typeof useDmsRouter>,
) {
	function syncUrl() {
		const tab = activeTab.value
		const query = { ...route.query }
		delete query.schema
		delete query.instance
		delete query.table
		delete query.match
		if (tab) {
			query.schema = tab.schema
			query.table = tab.table
			const instance = instanceToUrl(instanceChoiceOf(tab.instance))
			if (instance) query.instance = instance
		}
		if (
			Object.keys(query).length === Object.keys(route.query).length &&
			Object.entries(query).every(([key, value]) => route.query[key] === value)
		)
			return
		void router.replace({ query })
	}

	function routeTable() {
		const schema = route.query.schema
		const table = route.query.table
		if (!isText(schema) || !schema || !isText(table) || !table) return null
		const instance = tabInstanceOf(instanceFromUrl(route.query.instance))
		return {
			schema,
			instance,
			table,
			id: browserTabId(schema, instance, table),
			match: decodeMatch(route.query.match),
		}
	}

	return { syncUrl, routeTable }
}

interface TabsContext {
	state: TabsState
	grid: ReturnType<typeof useDataBrowserGrid>
	staged: ReturnType<typeof useStagedEdits>
	persist: () => void
	syncUrl: () => void
}

function createTabOperations({
	state: { tabs, activeId, activations, database, recent },
	grid,
	staged,
	persist,
	syncUrl,
}: TabsContext) {
	function activateTab(id: string) {
		const tab = tabs.value.find((candidate) => candidate.id === id)
		if (!tab) return
		if (database.value !== null) {
			rememberTable(database.value, {
				schema: tab.schema,
				instance: tab.instance,
				table: tab.table,
			})
			recent.value = readRecentTables(database.value)
		}
		activeId.value = id
		activations.value += 1
		syncUrl()
		persist()
	}

	function pinTab(id: string) {
		const tab = tabs.value.find((t) => t.id === id)
		if (!tab?.preview) return
		tabs.value = tabs.value.map((t) =>
			t.id === id ? { ...t, preview: false } : t,
		)
		persist()
	}

	function openTab(
		schema: string,
		instance: string,
		table: string,
		preview = true,
	) {
		const id = browserTabId(schema, instance, table)
		const existing = tabs.value.find((tab) => tab.id === id)
		if (existing) {
			if (!preview) pinTab(id)
			activateTab(id)
			return
		}
		const tab: BrowserTab = { id, schema, instance, table, preview }
		let replaceable = tabs.value.find((t) => t.preview)
		if (replaceable && staged.count(replaceable.id) > 0) {
			pinTab(replaceable.id)
			replaceable = undefined
		}
		if (preview && replaceable) {
			const replaced = replaceable
			tabs.value = tabs.value.map((t) => (t === replaced ? tab : t))
			grid.drop(replaced.id)
		} else {
			tabs.value = [...tabs.value, tab]
		}
		activateTab(id)
	}

	function replaceTab(
		oldId: string,
		schema: string,
		instance: string,
		table: string,
	) {
		const index = tabs.value.findIndex((tab) => tab.id === oldId)
		const old = tabs.value[index]
		if (!old) return openTab(schema, instance, table, false)
		const id = browserTabId(schema, instance, table)
		if (id === oldId) return activateTab(id)
		if (tabs.value.some((tab) => tab.id === id)) {
			tabs.value = tabs.value.filter((tab) => tab.id !== oldId)
			grid.drop(oldId)
			activateTab(id)
			return
		}
		const next = [...tabs.value]
		next[index] = { id, schema, instance, table, preview: old.preview }
		tabs.value = next
		grid.carry(oldId, id)
		grid.drop(oldId)
		activateTab(id)
	}

	function closeTab(id: string) {
		const index = tabs.value.findIndex((tab) => tab.id === id)
		if (index < 0) return
		const next = tabs.value.filter((tab) => tab.id !== id)
		tabs.value = next
		if (activeId.value === id) {
			activeId.value = (next[index] ?? next[index - 1])?.id ?? null
		}
		grid.drop(id)
		syncUrl()
		persist()
	}

	function moveTab(draggedId: string, targetId: string) {
		if (draggedId === targetId) return
		const next = [...tabs.value]
		const from = next.findIndex((tab) => tab.id === draggedId)
		const to = next.findIndex((tab) => tab.id === targetId)
		if (from < 0 || to < 0) return
		const [moved] = next.splice(from, 1)
		if (!moved) return
		next.splice(to, 0, moved)
		tabs.value = next
		persist()
	}

	return { activateTab, pinTab, openTab, replaceTab, closeTab, moveTab }
}

interface TabsSessionContext extends TabsContext {
	route: ReturnType<typeof useDmsRoute>
	routeTable: ReturnType<typeof createTabsUrl>['routeTable']
	openTab: ReturnType<typeof createTabOperations>['openTab']
}

function createTabsSession({
	state: { tabs, activeId, database, recent, activeTab },
	grid,
	staged,
	persist,
	syncUrl,
	route,
	routeTable,
	openTab,
}: TabsSessionContext) {
	function openFromRoute() {
		const target = routeTable()
		if (!target) return false
		const { schema, instance, table, id, match } = target
		if (!match && id === activeId.value) return true
		if (match) {
			const state = grid.getState(id)
			state.filters = { [match.field]: { mode: 'is', value: match.value } }
			state.page = 0
		}
		openTab(schema, instance, table, false)
		return true
	}

	function release(gone: BrowserTab[]): string[] {
		for (const tab of gone) {
			grid.drop(tab.id)
			staged.discard(tab.id)
		}
		return gone.map((tab) => tab.id)
	}

	function settle(owner: string | null, saved: PersistedTabs | null) {
		const dropped: string[] = []
		if (database.value !== null && database.value !== owner) {
			dropped.push(...release(tabs.value))
			tabs.value = []
			activeId.value = null
		}
		if (saved && (saved.database === owner || saved.database === null)) {
			tabs.value = saved.tabs
			activeId.value = saved.activeId
		} else if (saved) {
			dropped.push(...release(saved.tabs))
		}
		database.value = owner
		recent.value = owner === null ? [] : readRecentTables(owner)
		if (owner !== null && saved?.database !== owner) persist()
		return new Set(dropped)
	}

	function restore(selected: string | undefined) {
		const saved = readPersisted()
		const dropped = settle(selected ?? saved?.database ?? database.value, saved)
		const target = routeTable()
		if (target && dropped.has(target.id)) return syncUrl()
		if (!openFromRoute() && !route.query.schema && activeTab.value) syncUrl()
	}

	function follow(selected: string | undefined) {
		if (selected === undefined || selected === database.value) return
		if (settle(selected, null).size > 0) syncUrl()
	}

	return { openFromRoute, restore, follow }
}

/**
 * Shared state for the data-browser tabs: each tab pins a (schema, instance,
 * table) triplet. The active tab is mirrored to the URL query (deep-links) and
 * the whole tab set is persisted to sessionStorage (stays per browser tab); a
 * page refresh brings every tab back, the preview one still a preview.
 */
export function useDataBrowserTabs() {
	const state = useTabsState()
	const route = useDmsRoute()
	const router = useDmsRouter()
	const grid = useDataBrowserGrid()
	const staged = useStagedEdits()
	const persist = () => persistTabs(state)
	const { syncUrl, routeTable } = createTabsUrl(state, route, router)
	const context = { state, grid, staged, persist, syncUrl }
	const operations = createTabOperations(context)
	const session = createTabsSession({
		...context,
		route,
		routeTable,
		openTab: operations.openTab,
	})

	return {
		tabs: state.tabs,
		activeId: state.activeId,
		activeTab: state.activeTab,
		/**
		 * Counts the activations, a tab already active included: the sidebar
		 * follows the tab the user goes to, even back to the same one.
		 */
		activations: state.activations,
		/** When tabs span several schemas the tab bar disambiguates its labels. */
		hasMultipleSchemas: computed(
			() => new Set(state.tabs.value.map((tab) => tab.schema)).size > 1,
		),
		/** The tables opened lately on the tabs' database, newest first. */
		recent: computed(() => state.recent.value),
		/**
		 * Opens as a preview by default (VS Code-style: single-click reuses the
		 * preview slot). Pass preview = false for an explicitly permanent open
		 * (sidebar double-click, deep-links), which also pins the tab if already
		 * open as preview. A tab holding staged edits is never replaced.
		 */
		openTab: operations.openTab,
		/**
		 * Puts another table in a tab's place (an instance switch): same position,
		 * same preview state, and the grid's search, filters and sort carried
		 * over. A tab already open on that table is activated instead, and the
		 * replaced one closed.
		 */
		replaceTab: operations.replaceTab,
		/** Closes a tab; its grid state and cached rows go with it. */
		closeTab: operations.closeTab,
		activateTab: operations.activateTab,
		/** Promotes a preview tab to a permanent one (double-click, pin icon, drag). */
		pinTab: operations.pinTab,
		/**
		 * Moves the dragged tab to the target tab's position. A pure reorder:
		 * pinning on drag is a gesture policy that lives at the drop site.
		 */
		moveTab: operations.moveTab,
		/**
		 * Restores the tabs this browser tab kept on the selected database,
		 * preview included, then lets the URL win for the active selection. Tabs
		 * of another database, kept or still open, are dropped, and a URL that
		 * mirrors one of them is cleared. Call once, from the page's onMounted,
		 * with the selected connection's id, undefined when the selection is
		 * unknown.
		 */
		restore: session.restore,
		/**
		 * Follows a selection the page learns once restored (its connections
		 * read again in the background). Register it after restore().
		 */
		follow: session.follow,
		/**
		 * Opens, permanently, the table the URL names (overview links, the
		 * inspector's "Browse data", relation links, shared URLs); a link to one
		 * row opens the table filtered on it.
		 */
		openFromRoute: session.openFromRoute,
	}
}
