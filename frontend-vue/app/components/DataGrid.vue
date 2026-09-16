<script setup lang="ts">
import type { BrowserTab } from "../composables/useDataBrowserTabs";
import type {
	ColumnFilterState,
	GridColumn,
	GridData,
} from "../composables/useDataBrowserGrid";

const BROWSE_ENDPOINT = "/api/database/browse";
const QUERY_PATH = "/modules/database/query";
// Browse-only synthetic columns; never editable, never persisted.
const SYNTHETIC_FIELDS = new Set(["_instance"]);
const DEFAULT_COLUMN_WIDTH = 192;
// Primary key assumed when the backend reports none (e.g. MongoDB's implicit id).
const DEFAULT_PRIMARY_KEY = "_id";
// Debounce for the toolbar's global search input.
const SEARCH_DEBOUNCE_MS = 300;

interface ColumnsResponse {
	columns: string[];
	types: Record<string, string>;
	primaryKey: string | null;
}

interface ListResponse {
	results: Record<string, unknown>[];
	total: number;
	offset: number;
	limit: number;
	primaryKey: string | null;
}

const props = defineProps<{
	tab: BrowserTab;
	// Schema-introspected field names, used when the table is empty and the
	// backend column sampling returns nothing.
	fallbackFields: string[];
}>();

const { t } = useI18n();
const { $authFetch } = useAuthFetch();
const toast = useToast();
const router = useDmsRouter();
const grid = useDataBrowserGrid();
const { tabs: browserTabs, pinTab } = useDataBrowserTabs();

const state = grid.getState(props.tab.id);
const readOnly = computed(() => props.tab.instance === CROSS_INSTANCE_VALUE);

// --- data loading ---
const data = ref<GridData | null>(grid.getCache(props.tab.id));
const loading = ref(false);
const loadError = ref<string | null>(null);
let requestSeq = 0;
// Column metadata only depends on the tab's selection (the component remounts
// per tab), so it is fetched once — not on every page/sort/filter change — and
// refreshed only by an explicit reload. `null` means not fetched or failed.
const columnsMeta = ref<ColumnsResponse | null>(null);

async function load(force = false) {
	const key = browseParamsKey(props.tab, state);
	const cached = grid.getCache(props.tab.id);
	if (!force && cached && cached.paramsKey === key) {
		// Restoring from cache must also retire any in-flight request (its late
		// response would pass the seq guard and overwrite the cache with rows
		// for parameters the user has already left) and clear transient state
		// from a previous attempt.
		requestSeq += 1;
		data.value = cached;
		loadError.value = null;
		loading.value = false;
		return;
	}
	const seq = ++requestSeq;
	loading.value = true;
	loadError.value = null;
	try {
		const selection = browseSelectionQuery(props.tab);
		const needColumns = force || columnsMeta.value === null;
		const [columnsRes, listRes] = await Promise.all([
			needColumns
				? // A columns failure must not discard a successful rows fetch: the
					// grid falls back to schema-introspected field names instead.
					$authFetch<ColumnsResponse>(`${BROWSE_ENDPOINT}/columns`, {
						query: selection,
					}).catch(() => null)
				: Promise.resolve(columnsMeta.value),
			$authFetch<ListResponse>(`${BROWSE_ENDPOINT}/list`, {
				query: { ...selection, ...browseListQuery(state) },
			}),
		]);
		// Ignore a response that arrived after the params changed again.
		if (seq !== requestSeq) return;
		if (columnsRes) columnsMeta.value = columnsRes;
		const meta = columnsMeta.value;
		const primaryKey = listRes.primaryKey ?? meta?.primaryKey ?? null;
		const sampled = meta?.columns ?? [];
		const names = sampled.length > 0 ? sampled : props.fallbackFields;
		const next: GridData = {
			columns: names.map((name) => ({
				name,
				type: meta?.types[name] ?? "string",
				isPrimaryKey: name === (primaryKey ?? DEFAULT_PRIMARY_KEY),
			})),
			rows: listRes.results ?? [],
			total: listRes.total ?? 0,
			primaryKey,
			paramsKey: key,
		};
		grid.setCache(props.tab.id, next);
		data.value = next;
		// An open positional editor whose row no longer sits at the same index
		// must not survive a rows replacement (commit would target another row).
		const editingCell = editing.value;
		if (
			editingCell &&
			rowIdOf(next.rows[editingCell.r] ?? {}) !== editingCell.rowId
		) {
			cancelEdit();
		}
		// Clamp the page when the total shrank under the current offset (rows
		// deleted elsewhere): correcting state.page re-triggers the watcher.
		if (next.total > 0 && state.page * state.pageSize >= next.total) {
			state.page = Math.max(0, Math.ceil(next.total / state.pageSize) - 1);
		}
	} catch (error) {
		if (seq !== requestSeq) return;
		loadError.value = error instanceof Error ? error.message : String(error);
	} finally {
		if (seq === requestSeq) loading.value = false;
	}
}

watch(
	() => browseParamsKey(props.tab, state),
	() => load(),
	{ immediate: true },
);

// An empty table cached with no columns while the schemas fetch was still in
// flight must recover once the schema-introspected fields arrive — nothing
// else re-triggers the load (fallbackFields is not part of the params key).
watch(
	() => props.fallbackFields,
	(fields) => {
		if (
			fields.length > 0 &&
			(data.value?.columns.length ?? 0) === 0 &&
			!loading.value
		) {
			load(true);
		}
	},
);

function reload() {
	grid.invalidate(props.tab.id);
	load(true);
}

const columns = computed(() => data.value?.columns ?? []);
const rows = computed(() => data.value?.rows ?? []);
const total = computed(() => data.value?.total ?? 0);
const rowIdKey = computed(() => data.value?.primaryKey ?? DEFAULT_PRIMARY_KEY);

// --- toolbar: debounced global search ---
const searchDraft = ref(state.search);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchDraft, (value) => {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => {
		state.search = value.trim();
		state.page = 0;
	}, SEARCH_DEBOUNCE_MS);
});
onBeforeUnmount(() => {
	clearTimeout(searchTimer);
	// Retire any in-flight browse request: its late response would otherwise
	// setCache under this tab's id AFTER the tab was replaced/closed and
	// grid.drop() ran — resurrecting the entry, whose paramsKey then matches a
	// fresh default state on re-open and serves stale rows with no refetch.
	requestSeq += 1;
	// Flush (not drop) a pending draft so a search typed just before switching
	// tabs survives into this tab's state.
	const value = searchDraft.value.trim();
	if (value !== state.search) {
		state.search = value;
		state.page = 0;
	}
});

const activeFilterCount = computed(
	() => Object.values(state.filters).filter((filter) => filter.value).length,
);

function clearFilters() {
	state.filters = {};
	state.page = 0;
}

// --- sorting / filtering / resize ---
function toggleSort(name: string) {
	if (state.sortKey !== name) {
		state.sortKey = name;
		state.sortDirection = "asc";
	} else if (state.sortDirection === "asc") {
		state.sortDirection = "desc";
	} else {
		state.sortKey = null;
		state.sortDirection = "asc";
	}
	state.page = 0;
}

function setFilter(name: string, filter: ColumnFilterState | null) {
	const next = { ...state.filters };
	if (filter) next[name] = filter;
	else Reflect.deleteProperty(next, name);
	state.filters = next;
	state.page = 0;
}

function widthFor(name: string): number {
	return state.columnWidths[name] ?? DEFAULT_COLUMN_WIDTH;
}
function resizeColumn(name: string, width: number) {
	state.columnWidths = { ...state.columnWidths, [name]: width };
}

// --- pagination ---
const pageSizeOptions = GRID_PAGE_SIZES.map((size) => ({
	label: String(size),
	value: size,
}));
const pageStart = computed(() =>
	total.value === 0 ? 0 : state.page * state.pageSize + 1,
);
const pageEnd = computed(() =>
	Math.min(total.value, (state.page + 1) * state.pageSize),
);
const hasNext = computed(() => pageEnd.value < total.value);
function setPageSize(size: number) {
	state.pageSize = size;
	state.page = 0;
}

// --- open in query console (prefilled DSL, kept from the previous page) ---
function schemaAccessExpr(schemaId: string): string {
	// Dotted access for valid identifiers, bracket access otherwise — mirrors
	// the query builder's own schema resolution.
	return /^[A-Z_$][\w$]*$/i.test(schemaId)
		? `schemas.${schemaId}`
		: `schemas[${JSON.stringify(schemaId)}]`;
}
function instanceArgExpr(): string {
	if (props.tab.instance === DEFAULT_INSTANCE_VALUE) return "";
	if (props.tab.instance === CROSS_INSTANCE_VALUE) return "CROSS_INSTANCE";
	return JSON.stringify(props.tab.instance);
}
function openInQueryConsole() {
	const source = `${schemaAccessExpr(props.tab.schema)}.instance(${instanceArgExpr()}).table(${JSON.stringify(props.tab.table)}).slice(0, 100)`;
	router.push({ path: QUERY_PATH, query: { source } });
}

// --- cell focus & keyboard navigation ---
const scroller = useTemplateRef<HTMLDivElement>("scroller");
const focused = ref<{ r: number; c: number } | null>(null);

function focusCell(r: number, c: number) {
	focused.value = { r, c };
	nextTick(() => {
		scroller.value
			?.querySelector(`[data-cell="${r}:${c}"]`)
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	});
}

function onKeydown(event: KeyboardEvent) {
	if (editing.value || jsonPanel.value) return;
	const current = focused.value;
	if (!current) return;
	const maxR = rows.value.length - 1;
	const maxC = columns.value.length - 1;
	let { r, c } = current;
	switch (event.key) {
		case "ArrowUp":
			r -= 1;
			break;
		case "ArrowDown":
			r += 1;
			break;
		case "ArrowLeft":
			c -= 1;
			break;
		case "ArrowRight":
			c += 1;
			break;
		case "Tab": {
			// Tab past either edge releases focus to the browser (no trap): the
			// user can reach the toolbar/footer instead of being clamped inside.
			const nextColumn = c + (event.shiftKey ? -1 : 1);
			if (nextColumn < 0 || nextColumn > maxC) {
				focused.value = null;
				return;
			}
			c = nextColumn;
			break;
		}
		case "Enter":
			event.preventDefault();
			openEditorAt(current.r, current.c);
			return;
		case "Escape":
			focused.value = null;
			return;
		default:
			return;
	}
	event.preventDefault();
	focusCell(Math.max(0, Math.min(maxR, r)), Math.max(0, Math.min(maxC, c)));
}

// --- inline editing ---
// Both editors carry the target rowId captured at open time: a mid-edit reload
// replaces the rows array, and a stale positional index would silently write
// into whichever row now sits at that position. r/c only locate the visual
// cell; every write resolves the row by id at commit time.
const editing = ref<{
	r: number;
	c: number;
	rowId: string | null;
	field: string;
} | null>(null);
const invalidDraft = ref(false);
const pendingCell = ref<{ rowId: string; field: string } | null>(null);
const savingJson = ref(false);
const jsonPanel = ref<{
	rowId: string | null;
	field: string;
	value: unknown;
	readOnly: boolean;
} | null>(null);

function columnAt(c: number): GridColumn | null {
	return columns.value[c] ?? null;
}

function isCellEditable(field: string): boolean {
	if (readOnly.value) return false;
	if (field === DEFAULT_PRIMARY_KEY || field === rowIdKey.value) return false;
	if (SYNTHETIC_FIELDS.has(field)) return false;
	return true;
}

function rowIdOf(row: Record<string, unknown>): string | null {
	const id = row[rowIdKey.value];
	if (id === null || id === undefined) return null;
	return String(id);
}

function openEditorAt(r: number, c: number) {
	const column = columnAt(c);
	const row = rows.value[r];
	if (!column || !row) return;
	const value = row[column.name];
	if (value !== null && value !== undefined && typeof value === "object") {
		// Structured cell: always viewable through the JSON panel; editable only
		// when the field itself is writable and the row is addressable — the
		// backend silently drops writes to protected fields, so offering a Save
		// there would fake success.
		jsonPanel.value = {
			rowId: rowIdOf(row),
			field: column.name,
			value,
			readOnly: !isCellEditable(column.name) || rowIdOf(row) === null,
		};
		return;
	}
	// A row with no addressable primary key cannot be saved on any path, so
	// refuse to open the editor instead of failing at commit time (mirrors the
	// JSON panel's readOnly guard).
	const rowId = rowIdOf(row);
	if (!isCellEditable(column.name) || rowId === null) return;
	invalidDraft.value = false;
	editing.value = { r, c, rowId, field: column.name };
}

// Refocusing the grid after an editor closes must not steal focus from a
// control the user has since clicked (toolbar search, another cell's editor):
// only reclaim it when the blur left focus on the document body.
function refocusGrid() {
	nextTick(() => {
		if (document.activeElement === document.body) scroller.value?.focus();
	});
}

function cancelEdit() {
	editing.value = null;
	invalidDraft.value = false;
	refocusGrid();
}

// Shared persistence for both editors: PUT one field, then merge the echoed
// row into the row the grid currently renders (resolved by id AFTER the await
// — a concurrent reload may have replaced the rows array, and assigning into
// the pre-await capture would update a detached object).
async function persistField(rowId: string, field: string, value: unknown) {
	const updated = await $authFetch<Record<string, unknown>>(
		`${BROWSE_ENDPOINT}/edit`,
		{
			method: "PUT",
			query: { ...browseSelectionQuery(props.tab), id: rowId },
			body: { [field]: value },
		},
	);
	const live = rows.value.find((candidate) => rowIdOf(candidate) === rowId);
	if (live) Object.assign(live, updated);
	// A table the user edited is "modified" in the VS Code sense: pin its
	// preview tab so the next sidebar click doesn't silently discard it. Gate
	// on the tab OBJECT still being open — the id is content-derived, so a
	// slow edit whose tab was replaced then reopened would otherwise pin the
	// fresh preview without any pin gesture.
	if (browserTabs.value.includes(props.tab)) pinTab(props.tab.id);
}

async function commitCell(draftValue: string | boolean, source: "enter" | "blur") {
	const cell = editing.value;
	if (!cell) return;
	const column = columnAt(cell.c);
	// Resolve by the rowId captured at open time — never by position.
	const row = cell.rowId
		? rows.value.find((candidate) => rowIdOf(candidate) === cell.rowId)
		: undefined;
	if (!column || !row) {
		cancelEdit();
		return;
	}
	const before = row[column.name];

	// Preserve the stored type; a NULL cell falls back to the column's sampled
	// type so filling it can't silently flip a number/boolean column to string.
	const targetType =
		before === null || before === undefined ? column.type : typeof before;
	let next: string | number | boolean;
	if (targetType === "number") {
		const text = typeof draftValue === "string" ? draftValue.trim() : "";
		const parsed = Number(text);
		if (text === "" || !Number.isFinite(parsed)) {
			// Enter keeps the editor open to fix the draft; a blur-commit must not
			// leave an unfocused editor behind (it would deaden grid keyboard nav),
			// so click-away discards the invalid draft.
			if (source === "blur") cancelEdit();
			else invalidDraft.value = true;
			return;
		}
		next = parsed;
	} else if (targetType === "boolean") {
		const text =
			typeof draftValue === "string" ? draftValue.trim().toLowerCase() : draftValue;
		if (text === true || text === "true") next = true;
		else if (text === false || text === "false") next = false;
		else {
			if (source === "blur") cancelEdit();
			else invalidDraft.value = true;
			return;
		}
	} else {
		next = String(draftValue);
	}

	// A double-clicked NULL cell committed untouched must stay NULL — writing
	// "" over null on click-away would silently mutate the row.
	if (
		(before === null || before === undefined) &&
		typeof next === "string" &&
		next === ""
	) {
		cancelEdit();
		return;
	}

	// Unchanged echo: close silently, nothing to save.
	if (before !== null && before !== undefined && String(before) === String(next)) {
		cancelEdit();
		return;
	}

	const rowId = cell.rowId;
	if (!rowId) {
		toast.add({ title: t("dms_database.data.editError"), color: "error" });
		cancelEdit();
		return;
	}

	editing.value = null;
	invalidDraft.value = false;
	pendingCell.value = { rowId, field: column.name };
	try {
		await persistField(rowId, column.name, next);
	} catch (error) {
		handleEditError(error);
	} finally {
		pendingCell.value = null;
		refocusGrid();
	}
}

async function saveJson(value: unknown) {
	const panel = jsonPanel.value;
	if (!panel || panel.readOnly || !panel.rowId) return;
	savingJson.value = true;
	try {
		await persistField(panel.rowId, panel.field, value);
		jsonPanel.value = null;
	} catch (error) {
		handleEditError(error);
	} finally {
		savingJson.value = false;
	}
}

function handleEditError(error: unknown) {
	const status =
		(error as { statusCode?: number } | null)?.statusCode ??
		(error as { status?: number } | null)?.status;
	if (status === 404) {
		// The row vanished under us: tell the user, drop any open editor that
		// still points at it, and resync the page.
		toast.add({ title: t("dms_database.data.rowVanished"), color: "warning" });
		jsonPanel.value = null;
		reload();
		return;
	}
	const description = error instanceof Error ? error.message : undefined;
	toast.add({
		title: t("dms_database.data.editError"),
		description,
		color: "error",
	});
}

function isPending(row: Record<string, unknown>, field: string): boolean {
	const pending = pendingCell.value;
	return pending !== null && pending.field === field && rowIdOf(row) === pending.rowId;
}

// Cross-instance unions can repeat the same primary key across instances, so
// the instance tag joins the key to keep v-for keys unique.
function rowKey(row: Record<string, unknown>, index: number): string | number {
	const id = rowIdOf(row);
	if (id === null) return index;
	return readOnly.value ? `${String(row._instance ?? "")}::${id}` : id;
}
</script>

<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<!-- toolbar -->
		<div class="flex items-center gap-2 border-b border-default px-3 py-2">
			<UInput
				v-model="searchDraft"
				icon="i-ph-magnifying-glass"
				:placeholder="t('dms_database.data.searchPlaceholder')"
				size="sm"
				class="w-64"
			/>
			<UBadge
				v-if="activeFilterCount > 0"
				color="primary"
				variant="subtle"
				class="cursor-pointer"
				@click="clearFilters"
			>
				{{ t("dms_database.data.filtersActive", { count: activeFilterCount }) }} ✕
			</UBadge>
			<UTooltip v-if="readOnly" :text="t('dms_database.data.crossInstanceNotice')">
				<UBadge color="warning" variant="subtle" icon="i-ph-lock">
					{{ t("dms_database.data.readOnly") }}
				</UBadge>
			</UTooltip>
			<div class="ml-auto flex items-center gap-1.5">
				<UButton
					icon="i-ph-arrow-clockwise"
					variant="ghost"
					color="neutral"
					size="sm"
					:loading="loading"
					:label="t('dms_database.data.refresh')"
					@click="reload"
				/>
				<UButton
					icon="i-ph-code"
					variant="ghost"
					color="info"
					size="sm"
					:label="t('dms_database.data.openInQuery')"
					@click="openInQueryConsole"
				/>
			</div>
		</div>

		<!-- grid -->
		<div
			ref="scroller"
			class="relative min-h-0 flex-1 overflow-auto outline-none"
			tabindex="0"
			@keydown="onKeydown"
		>
			<table
				v-if="columns.length > 0"
				class="w-max min-w-full border-separate border-spacing-0"
				style="table-layout: fixed"
			>
				<colgroup>
					<col style="width: 44px">
					<col
						v-for="column in columns"
						:key="column.name"
						:style="{ width: `${widthFor(column.name)}px` }"
					>
				</colgroup>
				<thead class="sticky top-0 z-10">
					<tr>
						<th
							class="sticky left-0 z-20 border-r border-b border-default bg-elevated"
							scope="col"
						/>
						<DmsDatabaseDataGridHeaderCell
							v-for="column in columns"
							:key="column.name"
							:column="column"
							:sort-key="state.sortKey"
							:sort-direction="state.sortDirection"
							:filter="state.filters[column.name] ?? null"
							:width="widthFor(column.name)"
							@sort="toggleSort(column.name)"
							@filter="setFilter(column.name, $event)"
							@resize="resizeColumn(column.name, $event)"
						/>
					</tr>
				</thead>
				<tbody>
					<tr v-for="(row, r) in rows" :key="rowKey(row, r)">
						<td
							class="sticky left-0 z-[5] border-r border-b border-default bg-elevated px-2 py-1 text-right font-mono text-[10.5px] tabular-nums text-dimmed"
						>
							{{ state.page * state.pageSize + r + 1 }}
						</td>
						<DmsDatabaseDataGridCell
							v-for="(column, c) in columns"
							:key="column.name"
							:data-cell="`${r}:${c}`"
							:value="row[column.name]"
							:editable="isCellEditable(column.name)"
							:editing="editing?.r === r && editing?.c === c"
							:pending="isPending(row, column.name)"
							:invalid="invalidDraft && editing?.r === r && editing?.c === c"
							:focused="focused?.r === r && focused?.c === c"
							@select="focusCell(r, c)"
							@start-edit="openEditorAt(r, c)"
							@commit="commitCell"
							@cancel="cancelEdit"
							@open-json="openEditorAt(r, c)"
						/>
					</tr>
				</tbody>
			</table>

			<div
				v-if="columns.length === 0 && !loading"
				class="flex h-full items-center justify-center text-sm text-muted"
			>
				{{ t("dms_database.data.noColumns") }}
			</div>
			<div
				v-else-if="rows.length === 0 && !loading && !loadError"
				class="absolute inset-x-0 top-16 text-center text-sm text-muted"
			>
				{{ t("dms_database.data.noRows") }}
			</div>
			<div v-if="loadError" class="absolute inset-x-0 top-16 mx-auto max-w-md">
				<UAlert color="error" icon="i-ph-warning" :description="loadError" />
			</div>
			<div v-if="loading" class="absolute inset-x-0 top-0">
				<UProgress size="xs" />
			</div>
		</div>

		<!-- footer / pagination -->
		<div
			class="flex items-center gap-3 border-t border-default px-3 py-1.5 text-xs text-muted"
		>
			<span>{{ t("dms_database.data.rowsTotal", { count: total }) }}</span>
			<div class="ml-auto flex items-center gap-2">
				<USelect
					:model-value="state.pageSize"
					:items="pageSizeOptions"
					size="xs"
					class="w-20"
					@update:model-value="setPageSize($event as number)"
				/>
				<span class="tabular-nums">{{ pageStart }}–{{ pageEnd }}</span>
				<UButton
					icon="i-ph-caret-left"
					variant="ghost"
					color="neutral"
					size="xs"
					:disabled="state.page === 0"
					:aria-label="t('dms_database.data.prevPage')"
					@click="state.page -= 1"
				/>
				<UButton
					icon="i-ph-caret-right"
					variant="ghost"
					color="neutral"
					size="xs"
					:disabled="!hasNext"
					:aria-label="t('dms_database.data.nextPage')"
					@click="state.page += 1"
				/>
			</div>
		</div>

		<!-- JSON editor panel -->
		<DmsDatabaseJsonCellPanel
			:open="jsonPanel !== null"
			:column="jsonPanel?.field ?? ''"
			:value="jsonPanel?.value"
			:saving="savingJson"
			:read-only="jsonPanel?.readOnly ?? true"
			@update:open="jsonPanel = $event ? jsonPanel : null"
			@save="saveJson"
		/>
	</div>
</template>
