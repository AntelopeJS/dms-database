import { nextTick } from 'vue'
import { useDataBrowserGrid } from './useDataBrowserGrid'
import type { InstanceChoice } from '../data/instanceOptions'
import { rememberTable } from '../data/recentTables'
import { useStagedEdits } from '../data/stagedEdits'
import {
	ALL_INSTANCES_PARAM,
	decodeMatch,
	decodeNamedInstance,
	encodeNamedInstance,
} from '../utils/databaseLinks'

// Shared state for the data-browser tabs: each tab pins a (schema, instance,
// table) triplet. The active tab is mirrored to the URL query (deep-links) and
// the whole tab set is persisted to sessionStorage (stays per browser tab); a
// page refresh brings back the kept tabs only, never the preview one.

export const DEFAULT_INSTANCE_VALUE = '__DEFAULT__'
export const CROSS_INSTANCE_VALUE = '__CROSS_INSTANCE__'

/**
 * The URL's `instance` for a tab's: none for the default instance, "all"
 * for every instance, and a named one escaped when it could read as "all"
 * (see encodeNamedInstance).
 */
export function instanceToParam(instance: string): string | undefined {
	if (instance === DEFAULT_INSTANCE_VALUE) return undefined
	if (instance === CROSS_INSTANCE_VALUE) return ALL_INSTANCES_PARAM
	return encodeNamedInstance(instance)
}

/** A tab's instance from the URL's `instance`; the internal value still reads. */
export function instanceFromParam(param: unknown): string {
	if (typeof param !== 'string' || !param) return DEFAULT_INSTANCE_VALUE
	if (param === ALL_INSTANCES_PARAM || param === CROSS_INSTANCE_VALUE)
		return CROSS_INSTANCE_VALUE
	return decodeNamedInstance(param)
}

/** A tab's instance as an instance picker's choice ("all": read-only). */
export function instanceChoiceOf(instance: string): InstanceChoice {
	if (instance === DEFAULT_INSTANCE_VALUE) return { kind: 'default' }
	if (instance === CROSS_INSTANCE_VALUE) return { kind: 'all' }
	return { kind: 'named', id: instance }
}

/** The tab instance an instance picker's choice stands for. */
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
	// DEFAULT_INSTANCE_VALUE, CROSS_INSTANCE_VALUE or a named instance id.
	instance: string
	table: string
	// VS Code-style preview tab: the next openTab reuses it instead of adding
	// a new tab. At most one per session; pinning (double-click, pin icon,
	// drag-reorder, editing a cell) clears the flag.
	preview?: boolean
}

const STORAGE_KEY = 'dms-database:data-browser:tabs'
const URL_WRITES_STATE = 'dms-database-browser-url-writes'
const RESTORED_STATE = 'dms-database-browser-restored'
const ACTIVATIONS_STATE = 'dms-database-browser-activations'

function browserTabId(schema: string, instance: string, table: string): string {
	return `${schema}::${instance}::${table}`
}

/**
 * Whether the route names a table this browser wrote to the URL itself (the
 * active tab): it is then taken off `writes` with every older entry, which
 * the visit replaced. Such a route opens nothing, so a preview tab stays one.
 */
export function takeOwnUrlWrite(writes: string[], key: string): boolean {
	const index = writes.indexOf(key)
	if (index < 0) return false
	writes.splice(0, index + 1)
	return true
}

/**
 * Forgets a table syncUrl named once its visit settled without the route
 * reaching it (failed, cancelled, refused by a middleware): no route will
 * take it off, and it would hide a later link to that table. `landedId` is
 * the table the route names now.
 */
export function settleUrlWrite(
	writes: string[],
	key: string,
	landedId: string | null,
): void {
	if (landedId === key) return
	const index = writes.lastIndexOf(key)
	if (index >= 0) writes.splice(index, 1)
}

/**
 * What of the URL names a table, as a string a watcher compares by value.
 * Every useDmsRoute() call re-assigns the route from Inertia's page URL,
 * which keeps the previous URL until a visit lands: a grid mounting for a
 * newly active tab re-assigns that previous URL, with the same values. A
 * watcher on the query object would take it for a link to the previous table
 * and reopen it, even just closed.
 */
export function routeTableKey(query: Record<string, unknown>): string {
	return JSON.stringify([
		query.schema,
		query.table,
		query.instance,
		query.match,
	])
}

export interface PersistedTabs {
	tabs: BrowserTab[]
	activeId: string | null
}

export interface RestoredTabs extends PersistedTabs {
	// False when the route only names the dropped preview tab: the browser
	// wrote that URL itself, so it must not reopen the tab as a kept one.
	openRoute: boolean
}

/**
 * The tabs a page load brings back: the kept ones only, as a preview tab
 * never outlives the page. Were it active, its right neighbour takes over
 * (then its left one), as when a tab is closed. `routeId` is the tab the URL
 * names (null without one, or for a link to a row); on a reload, a URL naming
 * the dropped preview is the browser's own write of its active tab, not a
 * link, and is not followed.
 */
export function restoreTabs(
	persisted: PersistedTabs | null,
	routeId: string | null,
	reloaded: boolean,
): RestoredTabs {
	const all = persisted?.tabs ?? []
	const previewIndex = all.findIndex((tab) => tab.preview)
	const preview = previewIndex >= 0 ? all[previewIndex] : undefined
	const tabs = all.filter((tab) => !tab.preview)
	let activeId = persisted?.activeId ?? null
	if (!tabs.some((tab) => tab.id === activeId)) {
		const fallback =
			previewIndex >= 0
				? (tabs[previewIndex] ?? tabs[previewIndex - 1])
				: tabs[0]
		activeId = fallback?.id ?? null
	}
	return {
		tabs,
		activeId,
		openRoute: !(reloaded && preview && routeId === preview.id),
	}
}

// Whether the current URL is the one this document was reloaded (F5) or
// traversed back to: the URL the browser last wrote, not a link followed. A
// link followed in the app since the load (an overview's table, say) has
// changed the URL, so it still counts as a link.
function urlFromReload(): boolean {
	try {
		const entry = window.performance.getEntriesByType('navigation')[0] as
			| PerformanceNavigationTiming
			| undefined
		return (
			(entry?.type === 'reload' || entry?.type === 'back_forward') &&
			entry.name === window.location.href
		)
	} catch {
		return false
	}
}

function readPersisted(): PersistedTabs | null {
	if (typeof window === 'undefined') return null
	try {
		const raw = window.sessionStorage.getItem(STORAGE_KEY)
		if (!raw) return null
		const parsed = JSON.parse(raw) as PersistedTabs
		if (!Array.isArray(parsed.tabs)) return null
		const tabs = parsed.tabs
			.filter(
				(tab) =>
					tab &&
					typeof tab.schema === 'string' &&
					typeof tab.instance === 'string' &&
					typeof tab.table === 'string',
			)
			.map((tab) => ({
				...tab,
				id: browserTabId(tab.schema, tab.instance, tab.table),
				preview: tab.preview === true,
			}))
			// Recomputed ids can collide on a legacy/hand-edited payload; duplicate
			// ids would break the tab bar's v-for keys and closeTab.
			.filter(
				(tab, index, all) => all.findIndex((t) => t.id === tab.id) === index,
			)
		// The preview slot is a singleton; a hand-edited payload could carry
		// several — honour only the first.
		const firstPreview = tabs.findIndex((tab) => tab.preview)
		for (const [index, tab] of tabs.entries()) {
			if (index !== firstPreview) tab.preview = false
		}
		const activeId = tabs.some((tab) => tab.id === parsed.activeId)
			? parsed.activeId
			: (tabs[0]?.id ?? null)
		return { tabs, activeId }
	} catch {
		return null
	}
}

export function useDataBrowserTabs() {
	const tabs = useDmsState<BrowserTab[]>('dms-database-browser-tabs', () => [])
	const activeId = useDmsState<string | null>(
		'dms-database-browser-active',
		() => null,
	)
	// The tables syncUrl named, oldest first, until the route reaches them.
	const urlWrites = useDmsState<string[]>(URL_WRITES_STATE, () => [])
	// Set by the first restore of this document: later ones (the page left and
	// reopened) keep the session's tabs, preview included.
	const restored = useDmsState<boolean>(RESTORED_STATE, () => false)
	// Counts the activations, a tab already active included: the sidebar
	// follows the tab the user goes to, even back to the same one.
	const activations = useDmsState<number>(ACTIVATIONS_STATE, () => 0)
	const route = useDmsRoute()
	const router = useDmsRouter()
	// Captured at setup so closeTab can drop the closed tab's
	// grid state itself instead of relying on every caller to remember to.
	const grid = useDataBrowserGrid()
	const staged = useStagedEdits()

	const activeTab = computed(
		() => tabs.value.find((tab) => tab.id === activeId.value) ?? null,
	)
	// When tabs span several schemas the tab bar disambiguates its labels.
	const hasMultipleSchemas = computed(
		() => new Set(tabs.value.map((tab) => tab.schema)).size > 1,
	)

	function persist() {
		if (typeof window === 'undefined') return
		try {
			window.sessionStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ tabs: tabs.value, activeId: activeId.value }),
			)
		} catch {
			// Quota/private-mode failures only cost tab restoration.
		}
	}

	// The URL carries the ACTIVE tab only (deep-links); per-tab grid state
	// deliberately stays out of it.
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
			const instance = instanceToParam(tab.instance)
			if (instance) query.instance = instance
		}
		if (
			Object.keys(query).length === Object.keys(route.query).length &&
			Object.entries(query).every(([key, value]) => route.query[key] === value)
		)
			return
		if (!tab) {
			void router.replace({ query })
			return
		}
		const key = browserTabId(tab.schema, tab.instance, tab.table)
		urlWrites.value.push(key)
		// Once the visit settles (and the route watchers ran), a write the
		// route did not reach is dropped.
		const settle = async () => {
			await nextTick()
			const landed = routeTable()
			settleUrlWrite(
				urlWrites.value,
				key,
				landed && !landed.match ? landed.id : null,
			)
		}
		// A stubbed router may answer nothing: settle all the same.
		void Promise.resolve(router.replace({ query })).then(settle, settle)
	}

	function activateTab(id: string) {
		const tab = tabs.value.find((candidate) => candidate.id === id)
		if (!tab) return
		rememberTable({
			schema: tab.schema,
			instance: tab.instance,
			table: tab.table,
		})
		activeId.value = id
		activations.value += 1
		syncUrl()
		persist()
	}

	// Promote a preview tab to a permanent one (double-click, pin icon, drag).
	function pinTab(id: string) {
		const tab = tabs.value.find((t) => t.id === id)
		if (!tab?.preview) return
		tabs.value = tabs.value.map((t) =>
			t.id === id ? { ...t, preview: false } : t,
		)
		persist()
	}

	// Opens as a preview by default (VS Code-style: single-click reuses the
	// preview slot). Pass preview = false for an explicitly permanent open
	// (sidebar double-click, deep-links) — it also pins the tab if already
	// open as preview.
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
		let previewIndex = tabs.value.findIndex((t) => t.preview)
		// A tab holding staged edits is never replaced: it is kept instead
		// (staging a cell already keeps it; this guards any other path).
		if (previewIndex >= 0 && staged.count(tabs.value[previewIndex]!.id) > 0) {
			pinTab(tabs.value[previewIndex]!.id)
			previewIndex = -1
		}
		if (preview && previewIndex >= 0) {
			// Reuse the preview slot in place: swap its content, drop the replaced
			// tab's grid state (its id dies with it).
			const replaced = tabs.value[previewIndex]!
			const next = [...tabs.value]
			next[previewIndex] = tab
			tabs.value = next
			grid.drop(replaced.id)
		} else {
			tabs.value = [...tabs.value, tab]
		}
		activateTab(id)
	}

	/**
	 * Puts another table in a tab's place (an instance switch): same position,
	 * same preview state, and the grid's search, filters and sort carried
	 * over. A tab already open on that table is activated instead, and the
	 * replaced one closed.
	 */
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
			// Right neighbour first, then left — mirrors browser tab behaviour.
			activeId.value = (next[index] ?? next[index - 1])?.id ?? null
		}
		// The closed tab's grid state and cached rows go with it — otherwise they
		// leak for the rest of the session.
		grid.drop(id)
		syncUrl()
		persist()
	}

	// Reorder (drag & drop): move the dragged tab to the target tab's position.
	// Pure reorder — pin-on-drag is a gesture policy and lives at the drop site
	// (the tab bar's onDrop), not in this primitive.
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

	// Opens the table the URL names (overview links, the inspector's "Browse
	// data", relation links, shared URLs): permanently, since the preview
	// slot is for casual browsing from the list.
	// The table the URL names, if any.
	function routeTable() {
		const schema = route.query.schema
		const table = route.query.table
		if (
			typeof schema !== 'string' ||
			!schema ||
			typeof table !== 'string' ||
			!table
		)
			return null
		const instance = instanceFromParam(route.query.instance)
		return {
			schema,
			instance,
			table,
			id: browserTabId(schema, instance, table),
			// A link to one row (a relation, a reference) opens the table filtered
			// on it; the filter shows as a chip the user removes.
			match: decodeMatch(route.query.match),
		}
	}

	function openFromRoute() {
		const target = routeTable()
		if (!target) return false
		const { schema, instance, table, id, match } = target
		if (!match && takeOwnUrlWrite(urlWrites.value, id)) return true
		if (match) {
			const state = grid.getState(id)
			state.filters = { [match.field]: { mode: 'is', value: match.value } }
			state.page = 0
		}
		openTab(schema, instance, table, false)
		return true
	}

	// Restore persisted tabs, then let the URL win for the active selection.
	// Call once, from the page's onMounted. On a page load (the first restore
	// of the document) only the kept tabs come back; see restoreTabs.
	function restore() {
		const persisted = readPersisted()
		if (!restored.value) {
			restored.value = true
			const target = routeTable()
			const plan = restoreTabs(
				persisted,
				target && !target.match ? target.id : null,
				urlFromReload(),
			)
			tabs.value = plan.tabs
			activeId.value = plan.activeId
			persist()
			if (!plan.openRoute) {
				// The URL still names the dropped preview: point it at the tab
				// that took over, or at none.
				syncUrl()
				return
			}
		} else if (persisted) {
			tabs.value = persisted.tabs
			activeId.value = persisted.activeId
		}
		// A schema-only link (?schema=X) is the sidebar's to honour.
		if (!openFromRoute() && !route.query.schema && activeTab.value) syncUrl()
	}

	return {
		tabs,
		activeId,
		activeTab,
		activations,
		hasMultipleSchemas,
		openTab,
		replaceTab,
		closeTab,
		activateTab,
		pinTab,
		moveTab,
		restore,
		openFromRoute,
	}
}
