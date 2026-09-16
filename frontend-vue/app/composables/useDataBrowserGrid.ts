// Per-tab grid state (paging, sort, filters, column widths) and a data cache
// so switching tabs restores instantly without a refetch. Keyed by
// BrowserTab.id.

export interface ColumnFilterState {
	mode: "is" | "contains";
	value: string;
}

export interface GridState {
	page: number;
	pageSize: number;
	sortKey: string | null;
	sortDirection: "asc" | "desc";
	search: string;
	filters: Record<string, ColumnFilterState>;
	columnWidths: Record<string, number>;
}

export interface GridColumn {
	name: string;
	// Coarse runtime type sampled by the backend: string | number | boolean |
	// object | array | null | undefined.
	type: string;
	isPrimaryKey: boolean;
}

export interface GridData {
	columns: GridColumn[];
	rows: Record<string, unknown>[];
	total: number;
	primaryKey: string | null;
	// Serialised query parameters that produced this payload; lets the grid
	// skip refetching when nothing changed.
	paramsKey: string;
}

export const GRID_PAGE_SIZES = [25, 50, 100, 200];

function defaultGridState(): GridState {
	return {
		page: 0,
		pageSize: 25,
		sortKey: null,
		sortDirection: "asc",
		search: "",
		filters: {},
		columnWidths: {},
	};
}

export function useDataBrowserGrid() {
	const states = useDmsState<Record<string, GridState>>(
		"dms-database-grid-states",
		() => ({}),
	);
	const cache = useDmsState<Record<string, GridData>>(
		"dms-database-grid-cache",
		() => ({}),
	);

	function getState(tabId: string): GridState {
		if (!states.value[tabId]) states.value[tabId] = defaultGridState();
		return states.value[tabId];
	}

	function getCache(tabId: string): GridData | null {
		return cache.value[tabId] ?? null;
	}

	function setCache(tabId: string, data: GridData) {
		cache.value[tabId] = data;
	}

	function invalidate(tabId: string) {
		Reflect.deleteProperty(cache.value, tabId);
	}

	// Forget everything about a closed tab.
	function drop(tabId: string) {
		Reflect.deleteProperty(states.value, tabId);
		Reflect.deleteProperty(cache.value, tabId);
	}

	return { getState, getCache, setCache, invalidate, drop };
}

// --- query helpers shared by the grid ---

// Reserved by the wire protocol for table selection (the backend's
// SELECTION_FILTER_KEYS): a data filter on a column literally named `schema`,
// `table` or `instance` would clobber the selection parameters, so it is never
// emitted and the filter UI is disabled for these columns.
const RESERVED_FILTER_FIELDS = new Set(["schema", "table", "instance"]);

export function isReservedFilterField(field: string): boolean {
	return RESERVED_FILTER_FIELDS.has(field);
}

// Normalized (empty-pruned, reserved-pruned, name-sorted) filter entries: the
// single source for both the wire query and the cache key, so key-insertion
// order or an empty draft can't cause spurious cache misses.
function activeFilterEntries(
	state: GridState,
): Array<[string, ColumnFilterState]> {
	return Object.entries(state.filters)
		.filter(([field, filter]) => filter.value && !isReservedFilterField(field))
		.sort(([a], [b]) => a.localeCompare(b));
}

// Single encoder for the `<mode>:<value>` wire tokens parseFilter decodes
// server-side (src/utils/query.ts) — the grammar is defined here once instead
// of scattered string literals.
export function filterToken(mode: "is" | "contains", value: string): string {
	return `${mode}:${value}`;
}

export function isFilterToken(value: string): string {
	return filterToken("is", value);
}

// Selection filters identifying the table, in the wire format the browse
// backend decodes (see resolveSelection in src/routes/data.ts).
export function browseSelectionQuery(tab: BrowserTab): Record<string, string> {
	const query: Record<string, string> = {
		filter_schema: isFilterToken(tab.schema),
		filter_table: isFilterToken(tab.table),
	};
	if (tab.instance !== DEFAULT_INSTANCE_VALUE) {
		query.filter_instance = isFilterToken(tab.instance);
	}
	return query;
}

export function browseListQuery(
	state: GridState,
): Record<string, string | number> {
	const query: Record<string, string | number> = {
		offset: state.page * state.pageSize,
		limit: state.pageSize,
		sortDirection: state.sortDirection,
	};
	if (state.sortKey) query.sortKey = state.sortKey;
	if (state.search) query.search = state.search;
	for (const [field, filter] of activeFilterEntries(state)) {
		query[`filter_${field}`] = filterToken(filter.mode, filter.value);
	}
	return query;
}

// Everything that changes the server payload (column widths deliberately not).
export function browseParamsKey(tab: BrowserTab, state: GridState): string {
	return JSON.stringify([
		tab.id,
		state.page,
		state.pageSize,
		state.sortKey,
		state.sortDirection,
		state.search,
		activeFilterEntries(state),
	]);
}
