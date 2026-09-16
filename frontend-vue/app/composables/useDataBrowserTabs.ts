// Shared state for the data-browser tabs: each tab pins a (schema, instance,
// table) triplet. The active tab is mirrored to the URL query (deep-links) and
// the whole tab set is persisted to sessionStorage (survives a page refresh,
// stays per browser tab).

export const DEFAULT_INSTANCE_VALUE = "__DEFAULT__";
export const CROSS_INSTANCE_VALUE = "__CROSS_INSTANCE__";

export interface BrowserTab {
	id: string;
	schema: string;
	// DEFAULT_INSTANCE_VALUE, CROSS_INSTANCE_VALUE or a named instance id.
	instance: string;
	table: string;
	// VS Code-style preview tab: the next openTab reuses it instead of adding
	// a new tab. At most one per session; pinning (double-click, pin icon,
	// drag-reorder, editing a cell) clears the flag.
	preview?: boolean;
}

const STORAGE_KEY = "dms-database:data-browser:tabs";

function browserTabId(
	schema: string,
	instance: string,
	table: string,
): string {
	return `${schema}::${instance}::${table}`;
}

interface PersistedTabs {
	tabs: BrowserTab[];
	activeId: string | null;
}

function readPersisted(): PersistedTabs | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as PersistedTabs;
		if (!Array.isArray(parsed.tabs)) return null;
		const tabs = parsed.tabs
			.filter(
				(tab) =>
					tab &&
					typeof tab.schema === "string" &&
					typeof tab.instance === "string" &&
					typeof tab.table === "string",
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
			);
		// The preview slot is a singleton; a hand-edited payload could carry
		// several — honour only the first.
		const firstPreview = tabs.findIndex((tab) => tab.preview);
		for (const [index, tab] of tabs.entries()) {
			if (index !== firstPreview) tab.preview = false;
		}
		const activeId = tabs.some((tab) => tab.id === parsed.activeId)
			? parsed.activeId
			: (tabs[0]?.id ?? null);
		return { tabs, activeId };
	} catch {
		return null;
	}
}

export function useDataBrowserTabs() {
	const tabs = useDmsState<BrowserTab[]>("dms-database-browser-tabs", () => []);
	const activeId = useDmsState<string | null>(
		"dms-database-browser-active",
		() => null,
	);
	const route = useDmsRoute();
	const router = useDmsRouter();
	// Captured at setup so closeTab can drop the closed tab's
	// grid state itself instead of relying on every caller to remember to.
	const grid = useDataBrowserGrid();

	const activeTab = computed(
		() => tabs.value.find((tab) => tab.id === activeId.value) ?? null,
	);
	// When tabs span several schemas the tab bar disambiguates its labels.
	const hasMultipleSchemas = computed(
		() => new Set(tabs.value.map((tab) => tab.schema)).size > 1,
	);

	function persist() {
		if (typeof window === "undefined") return;
		try {
			window.sessionStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ tabs: tabs.value, activeId: activeId.value }),
			);
		} catch {
			// Quota/private-mode failures only cost tab restoration.
		}
	}

	// The URL carries the ACTIVE tab only (deep-links); per-tab grid state
	// deliberately stays out of it.
	function syncUrl() {
		const tab = activeTab.value;
		const query = { ...route.query };
		delete query.schema;
		delete query.instance;
		delete query.table;
		if (tab) {
			query.schema = tab.schema;
			query.table = tab.table;
			if (tab.instance !== DEFAULT_INSTANCE_VALUE) query.instance = tab.instance;
		}
		if (
			Object.keys(query).length === Object.keys(route.query).length &&
			Object.entries(query).every(([key, value]) => route.query[key] === value)
		) return;
		router.replace({ query });
	}

	function activateTab(id: string) {
		if (!tabs.value.some((tab) => tab.id === id)) return;
		activeId.value = id;
		syncUrl();
		persist();
	}

	// Promote a preview tab to a permanent one (double-click, pin icon, drag).
	function pinTab(id: string) {
		const tab = tabs.value.find((t) => t.id === id);
		if (!tab?.preview) return;
		tabs.value = tabs.value.map((t) =>
			t.id === id ? { ...t, preview: false } : t,
		);
		persist();
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
		const id = browserTabId(schema, instance, table);
		const existing = tabs.value.find((tab) => tab.id === id);
		if (existing) {
			if (!preview) pinTab(id);
			activateTab(id);
			return;
		}
		const tab: BrowserTab = { id, schema, instance, table, preview };
		const previewIndex = tabs.value.findIndex((t) => t.preview);
		if (preview && previewIndex >= 0) {
			// Reuse the preview slot in place: swap its content, drop the replaced
			// tab's grid state (its id dies with it).
			const replaced = tabs.value[previewIndex]!;
			const next = [...tabs.value];
			next[previewIndex] = tab;
			tabs.value = next;
			grid.drop(replaced.id);
		} else {
			tabs.value = [...tabs.value, tab];
		}
		activateTab(id);
	}

	function closeTab(id: string) {
		const index = tabs.value.findIndex((tab) => tab.id === id);
		if (index < 0) return;
		const next = tabs.value.filter((tab) => tab.id !== id);
		tabs.value = next;
		if (activeId.value === id) {
			// Right neighbour first, then left — mirrors browser tab behaviour.
			activeId.value = (next[index] ?? next[index - 1])?.id ?? null;
		}
		// The closed tab's grid state and cached rows go with it — otherwise they
		// leak for the rest of the session.
		grid.drop(id);
		syncUrl();
		persist();
	}

	// Reorder (drag & drop): move the dragged tab to the target tab's position.
	// Pure reorder — pin-on-drag is a gesture policy and lives at the drop site
	// (the tab bar's onDrop), not in this primitive.
	function moveTab(draggedId: string, targetId: string) {
		if (draggedId === targetId) return;
		const next = [...tabs.value];
		const from = next.findIndex((tab) => tab.id === draggedId);
		const to = next.findIndex((tab) => tab.id === targetId);
		if (from < 0 || to < 0) return;
		const [moved] = next.splice(from, 1);
		if (!moved) return;
		next.splice(to, 0, moved);
		tabs.value = next;
		persist();
	}

	// Restore persisted tabs, then let the URL win for the active selection so
	// existing deep-links keep working. Call exactly once, from the page's
	// onMounted.
	function restore() {
		const persisted = readPersisted();
		if (persisted) {
			tabs.value = persisted.tabs;
			activeId.value = persisted.activeId;
		}
		const schema = route.query.schema;
		const table = route.query.table;
		if (
			typeof schema === "string" &&
			schema &&
			typeof table === "string" &&
			table
		) {
			const instance =
				typeof route.query.instance === "string" && route.query.instance
					? route.query.instance
					: DEFAULT_INSTANCE_VALUE;
			// Deep-links carry explicit intent (overview row double-click, the
			// inspector's "browse data" button, shared URLs): open permanently, the
			// preview slot is for casual sidebar browsing only.
			openTab(schema, instance, table, false);
		} else if (!schema && activeTab.value) {
			// Only reclaim the URL when it carries no selection at all: a
			// schema-only deep-link (?schema=X) is the sidebar's to honour and
			// must not be clobbered by the restored tab.
			syncUrl();
		}
	}

	return {
		tabs,
		activeId,
		activeTab,
		hasMultipleSchemas,
		openTab,
		closeTab,
		activateTab,
		pinTab,
		moveTab,
		restore,
	};
}
