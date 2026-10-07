<script setup lang="ts">
import {
	CROSS_INSTANCE_VALUE,
	DEFAULT_INSTANCE_VALUE,
	useDataBrowserTabs,
} from '../build/composables/useDataBrowserTabs'
import { useDatabaseSchemas } from '../build/composables/useDatabaseSchemas'
import {
	GRID_PAGE_SIZES,
	browseListQuery,
	browseParamsKey,
	browseSelectionQuery,
	useDataBrowserGrid,
} from '../build/composables/useDataBrowserGrid'
import { onKeyStroke, useEventListener } from '@vueuse/core'
import { parseDraft } from '../build/data/cellValues'
import { useStagedEdits } from '../build/data/stagedEdits'
import { useStagedSave } from '../build/data/useStagedSave'
import type { TableSummary } from '../build/composables/useDatabaseSchemas'
import type { BrowserTab } from '../build/composables/useDataBrowserTabs'
import type {
	ColumnFilterState,
	GridColumn,
	GridData,
} from '../build/composables/useDataBrowserGrid'
import { DATABASE_PAGES, tableAccess } from '../build/utils/databaseLinks'
import { type ColumnRole, isPrimaryKey } from '../build/utils/fieldTypes'
import DataFilterBar from './DataFilterBar.vue'
import DataGridCell from './DataGridCell.vue'
import DataGridHeaderCell from './DataGridHeaderCell.vue'
import JsonCellPanel from './JsonCellPanel.vue'
import RowDrawer from './RowDrawer.vue'

// The grid of one open table. Rows are read a page at a time; a committed
// cell is staged, not written (D-02): the save bar offers a review of every
// change before it is written, and the toast after the save an undo.

const BROWSE_ENDPOINT = '/api/database/browse'
// Browse-only columns: the source instance of a cross-instance read.
const SYNTHETIC_FIELDS = new Set(['_instance'])
const DEFAULT_COLUMN_WIDTH = 180
// Primary key assumed when the backend reports none (MongoDB's implicit id).
const DEFAULT_PRIMARY_KEY = '_id'
const SEARCH_DEBOUNCE_MS = 300
const PAGE_WINDOW = 2

interface ColumnsResponse {
	columns: string[]
	types: Record<string, string>
	primaryKey: string | null
}

interface ListResponse {
	results: Record<string, unknown>[]
	total: number
	primaryKey: string | null
}

const props = defineProps<{
	tab: BrowserTab
	/** The table as introspected: its declared columns and relations. */
	table?: TableSummary
}>()

const { t, n } = useI18n()
const { $authFetch } = useAuthFetch()
const router = useDmsRouter()
const grid = useDataBrowserGrid()
const staged = useStagedEdits()
const { tabs: browserTabs, pinTab, openTab } = useDataBrowserTabs()
const { open: openDrawer } = useDrawer()
const { schemas } = useDatabaseSchemas()

const state = grid.getState(props.tab.id)
const readOnly = computed(() => props.tab.instance === CROSS_INSTANCE_VALUE)

// --- data loading ---
const data = ref<GridData | null>(grid.getCache(props.tab.id))
const loading = ref(false)
const loadError = ref<string | null>(null)
let requestSeq = 0
// Column metadata only depends on the tab, so it is read once per mount.
const columnsMeta = ref<ColumnsResponse | null>(null)

function columnsOf(
	meta: ColumnsResponse | null,
	primaryKey: string | null,
): GridColumn[] {
	const sampled = meta?.columns ?? []
	const names =
		sampled.length > 0 ? sampled : Object.keys(props.table?.fields ?? {})
	return names.map((name) => ({
		name,
		type: meta?.types[name] ?? 'string',
		isPrimaryKey: name === (primaryKey ?? DEFAULT_PRIMARY_KEY),
	}))
}

async function fetchPage(force: boolean) {
	const selection = browseSelectionQuery(props.tab)
	const needColumns = force || columnsMeta.value === null
	return Promise.all([
		needColumns
			? // A columns failure must not discard the rows: the grid falls back
				// to the introspected fields.
				$authFetch<ColumnsResponse>(`${BROWSE_ENDPOINT}/columns`, {
					query: selection,
				}).catch(() => null)
			: Promise.resolve(columnsMeta.value),
		$authFetch<ListResponse>(`${BROWSE_ENDPOINT}/list`, {
			query: { ...selection, ...browseListQuery(state) },
		}),
	])
}

async function load(force = false) {
	const key = browseParamsKey(props.tab, state)
	const cached = grid.getCache(props.tab.id)
	if (!force && cached && cached.paramsKey === key) {
		// Retire a request in flight: its late answer would overwrite the cache
		// with rows for parameters the user has left.
		requestSeq += 1
		data.value = cached
		loadError.value = null
		loading.value = false
		return
	}
	const seq = ++requestSeq
	loading.value = true
	loadError.value = null
	try {
		const [columnsRes, listRes] = await fetchPage(force)
		if (seq !== requestSeq) return
		if (columnsRes) columnsMeta.value = columnsRes
		const primaryKey =
			listRes.primaryKey ?? columnsMeta.value?.primaryKey ?? null
		const next: GridData = {
			columns: columnsOf(columnsMeta.value, primaryKey),
			rows: listRes.results ?? [],
			total: listRes.total ?? 0,
			primaryKey,
			paramsKey: key,
		}
		grid.setCache(props.tab.id, next)
		data.value = next
		if (
			editing.value &&
			rowIdOf(next.rows[editing.value.r] ?? {}) !== editing.value.rowId
		) {
			cancelEdit()
		}
		// Rows deleted elsewhere can leave the page past the end.
		if (next.total > 0 && state.page * state.pageSize >= next.total) {
			state.page = Math.max(0, Math.ceil(next.total / state.pageSize) - 1)
		}
	} catch (error) {
		if (seq !== requestSeq) return
		loadError.value = error instanceof Error ? error.message : String(error)
	} finally {
		if (seq === requestSeq) loading.value = false
	}
}

watch(
	() => browseParamsKey(props.tab, state),
	() => load(),
	{ immediate: true },
)

// A table cached empty while the schemas were still loading recovers once
// its introspected fields arrive.
watch(
	() => props.table,
	(table) => {
		if (table && (data.value?.columns.length ?? 0) === 0 && !loading.value)
			load(true)
	},
)

function reload() {
	grid.invalidate(props.tab.id)
	load(true)
}

const columns = computed(() => data.value?.columns ?? [])
const rows = computed(() => data.value?.rows ?? [])
const total = computed(() => data.value?.total ?? 0)
const rowIdKey = computed(() => data.value?.primaryKey ?? DEFAULT_PRIMARY_KEY)
const visibleColumns = computed(() =>
	readOnly.value || !columns.value.some((column) => column.name === '_instance')
		? columns.value
		: columns.value.filter((column) => column.name !== '_instance'),
)

const relationFields = computed(
	() =>
		new Set(
			(props.table?.relations ?? []).map((relation) => relation.fromField),
		),
)

function roleOf(column: GridColumn): ColumnRole {
	if (
		column.isPrimaryKey ||
		isPrimaryKey(column.name, props.table?.indexes ?? {})
	)
		return 'key'
	return relationFields.value.has(column.name) ? 'relation' : 'plain'
}

function rowIdOf(row: Record<string, unknown>): string | null {
	const id = row[rowIdKey.value]
	return id === null || id === undefined ? null : String(id)
}

function isCellEditable(field: string, row: Record<string, unknown>): boolean {
	if (readOnly.value || rowIdOf(row) === null) return false
	return (
		field !== DEFAULT_PRIMARY_KEY &&
		field !== rowIdKey.value &&
		!SYNTHETIC_FIELDS.has(field)
	)
}

// --- toolbar: debounced search ---
const searchDraft = ref(state.search)
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement }>(
	'searchInput',
)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchDraft, (value) => {
	clearTimeout(searchTimer)
	searchTimer = setTimeout(() => {
		state.search = value.trim()
		state.page = 0
	}, SEARCH_DEBOUNCE_MS)
})
onBeforeUnmount(() => {
	clearTimeout(searchTimer)
	requestSeq += 1
	const value = searchDraft.value.trim()
	if (value !== state.search) {
		state.search = value
		state.page = 0
	}
})

// --- filters, sort, widths ---
function setFilter(name: string, filter: ColumnFilterState | null) {
	const next = { ...state.filters }
	if (filter) next[name] = filter
	else Reflect.deleteProperty(next, name)
	state.filters = next
	state.page = 0
}

function clearFilters() {
	state.filters = {}
	state.page = 0
}

function clearRefinements() {
	state.filters = {}
	state.search = ''
	searchDraft.value = ''
	state.page = 0
}

function toggleSort(name: string) {
	if (state.sortKey !== name) {
		state.sortKey = name
		state.sortDirection = 'asc'
	} else if (state.sortDirection === 'asc') {
		state.sortDirection = 'desc'
	} else {
		state.sortKey = null
		state.sortDirection = 'asc'
	}
	state.page = 0
}

function widthFor(name: string): number {
	return state.columnWidths[name] ?? DEFAULT_COLUMN_WIDTH
}

function resizeColumn(name: string, width: number) {
	state.columnWidths = { ...state.columnWidths, [name]: width }
}

// --- pagination ---
const pageSizeOptions = GRID_PAGE_SIZES.map((size) => ({
	label: String(size),
	value: size,
}))
const pageCount = computed(() =>
	Math.max(1, Math.ceil(total.value / state.pageSize)),
)
const pageStart = computed(() =>
	total.value === 0 ? 0 : state.page * state.pageSize + 1,
)
const pageEnd = computed(() =>
	Math.min(total.value, (state.page + 1) * state.pageSize),
)
const pages = computed(() => {
	const last = pageCount.value - 1
	const around = new Set([0, last])
	for (
		let page = state.page - PAGE_WINDOW;
		page <= state.page + PAGE_WINDOW;
		page += 1
	) {
		if (page >= 0 && page <= last) around.add(page)
	}
	return [...around].sort((a, b) => a - b)
})

function setPageSize(size: number) {
	state.pageSize = size
	state.page = 0
}

// --- links out ---
function openInQueryConsole() {
	const instance =
		props.tab.instance === DEFAULT_INSTANCE_VALUE || readOnly.value
			? undefined
			: props.tab.instance
	const source = `${tableAccess({ schema: props.tab.schema, table: props.tab.table, instance })}.slice(0, 100)`
	router.push({ path: DATABASE_PAGES.query, query: { source } })
}

const namedInstances = computed(
	() =>
		schemas.value.find((schema) => schema.id === props.tab.schema)?.instances ??
		[],
)

function switchInstance(instance: string) {
	openTab(props.tab.schema, instance, props.tab.table, false)
}

// --- cell focus and keyboard ---
const scroller = useTemplateRef<HTMLDivElement>('scroller')
const focused = ref<{ r: number; c: number } | null>(null)

function focusCell(r: number, c: number) {
	focused.value = { r, c }
	nextTick(() => {
		scroller.value
			?.querySelector(`[data-cell="${r}:${c}"]`)
			?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
	})
}

const MOVES: Record<
	string,
	(cell: { r: number; c: number }) => { r: number; c: number }
> = {
	ArrowUp: ({ r, c }) => ({ r: r - 1, c }),
	ArrowDown: ({ r, c }) => ({ r: r + 1, c }),
	ArrowLeft: ({ r, c }) => ({ r, c: c - 1 }),
	ArrowRight: ({ r, c }) => ({ r, c: c + 1 }),
}

function onKeydown(event: KeyboardEvent) {
	const current = focused.value
	if (editing.value || !current) return
	if (event.key === 'Enter') {
		event.preventDefault()
		openEditorAt(current.r, current.c)
		return
	}
	if (event.key === ' ') {
		event.preventDefault()
		openRow(current.r)
		return
	}
	if (event.key === 'Escape') {
		focused.value = null
		return
	}
	const move = MOVES[event.key]
	if (!move) return
	event.preventDefault()
	const next = move(current)
	focusCell(
		Math.max(0, Math.min(rows.value.length - 1, next.r)),
		Math.max(0, Math.min(visibleColumns.value.length - 1, next.c)),
	)
}

// --- inline editing: a commit stages the value ---
const editing = ref<{
	r: number
	c: number
	rowId: string
	field: string
} | null>(null)
const invalidReason = ref<string | null>(null)
const jsonPanel = ref<{
	rowId: string | null
	field: string
	value: unknown
	readOnly: boolean
} | null>(null)

function stagedCell(row: Record<string, unknown>, field: string) {
	const rowId = rowIdOf(row)
	return rowId === null ? undefined : staged.get(props.tab.id, rowId, field)
}

function currentValue(row: Record<string, unknown>, field: string): unknown {
	const cell = stagedCell(row, field)
	return cell ? cell.after : row[field]
}

function openEditorAt(r: number, c: number) {
	const column = visibleColumns.value[c]
	const row = rows.value[r]
	if (!column || !row) return
	const value = currentValue(row, column.name)
	const rowId = rowIdOf(row)
	if (value !== null && typeof value === 'object') {
		jsonPanel.value = {
			rowId,
			field: column.name,
			value,
			readOnly: !isCellEditable(column.name, row),
		}
		return
	}
	if (!isCellEditable(column.name, row) || rowId === null) return
	invalidReason.value = null
	editing.value = { r, c, rowId, field: column.name }
}

function refocusGrid() {
	nextTick(() => {
		if (document.activeElement === document.body) scroller.value?.focus()
	})
}

function cancelEdit() {
	editing.value = null
	invalidReason.value = null
	refocusGrid()
}

function stage(rowId: string, field: string, value: unknown) {
	const row = rows.value.find((candidate) => rowIdOf(candidate) === rowId)
	if (!row) return
	staged.stage(props.tab.id, { rowId, field, before: row[field], after: value })
	// A table with staged edits is kept: the next table opened from the list
	// must not replace it.
	if (browserTabs.value.includes(props.tab)) pinTab(props.tab.id)
}

function commitCell(draft: string | boolean, source: 'enter' | 'blur') {
	const cell = editing.value
	if (!cell) return
	const column = visibleColumns.value[cell.c]
	const row = rows.value.find((candidate) => rowIdOf(candidate) === cell.rowId)
	if (!column || !row) return cancelEdit()
	const result = parseDraft(draft, currentValue(row, column.name), column.type)
	if (!result.ok) {
		// Enter keeps the editor open to fix the draft; a click elsewhere drops it.
		if (source === 'blur') return cancelEdit()
		invalidReason.value = t(`dms_database.data.grid.invalid_${result.reason}`)
		return
	}
	if (!result.unchanged) stage(cell.rowId, column.name, result.value)
	editing.value = null
	invalidReason.value = null
	refocusGrid()
}

function stageJson(value: unknown) {
	const panel = jsonPanel.value
	if (!panel || panel.readOnly || !panel.rowId) return
	stage(panel.rowId, panel.field, value)
	jsonPanel.value = null
}

// --- staged changes: review, save, undo ---
const pendingCount = computed(() => staged.count(props.tab.id))
const changedFields = computed(() => [
	...new Set(staged.list(props.tab.id).map((change) => change.field)),
])
const { saving, review } = useStagedSave({
	tab: () => props.tab,
	onSaved: reload,
	onRowGone: reload,
})

onKeyStroke('s', (event) => {
	if (!(event.metaKey || event.ctrlKey) || pendingCount.value === 0) return
	event.preventDefault()
	review()
})

// --- the row drawer ---
function rowNavigation(index: number) {
	return {
		index,
		total: rows.value.length,
		hasPrev: index > 0,
		hasNext: index < rows.value.length - 1,
		prev: () => showRow(index - 1),
		next: () => showRow(index + 1),
	}
}

let drawer: ReturnType<typeof openDrawer> | null = null

function rowDrawerOptions(index: number) {
	const row = rows.value[index] ?? {}
	return {
		componentKey: `${props.tab.id}:${rowIdOf(row) ?? index}`,
		title: t('dms_database.data.row.title', { table: props.tab.table }),
		componentOptions: {
			tab: props.tab,
			row,
			rowId: rowIdOf(row),
			columns: visibleColumns.value,
			table: props.table,
			readOnly: readOnly.value,
			navigation: rowNavigation(index),
			onStage: stage,
			onReview: review,
		},
	}
}

function showRow(index: number) {
	if (index < 0 || index >= rows.value.length) return
	drawer?.patch(rowDrawerOptions(index))
}

function openRow(index: number) {
	if (!rows.value[index]) return
	drawer = openDrawer({
		direction: 'right',
		component: RowDrawer,
		...rowDrawerOptions(index),
	})
	drawer.result.finally(() => {
		drawer = null
	})
}

// Cross-instance unions can repeat a primary key across instances.
function rowKey(row: Record<string, unknown>, index: number): string | number {
	const id = rowIdOf(row)
	if (id === null) return index
	return readOnly.value ? `${String(row._instance ?? '')}::${id}` : id
}

const hasRefinements = computed(
	() =>
		state.search !== '' ||
		Object.values(state.filters).some((filter) => filter.value),
)

useEventListener('keydown', (event: KeyboardEvent) => {
	const target = event.target as HTMLElement | null
	if (target?.closest('input, textarea, select, [contenteditable=true]')) return
	if (event.metaKey || event.ctrlKey || event.altKey) return
	if (event.key === '/') {
		event.preventDefault()
		searchInput.value?.inputRef?.focus()
	} else if (event.key === 'r' && !editing.value) {
		reload()
	}
})
</script>

<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<div
			class="border-default flex flex-wrap items-center gap-2 border-b px-3 py-2"
		>
			<div class="flex items-baseline gap-2">
				<span class="text-highlighted font-mono text-sm font-semibold">
					{{ tab.table }}
				</span>
				<span class="text-dimmed font-mono text-xs tabular-nums">
					{{ t('dms_database.data.grid.rows', { count: n(total) }, total) }}
				</span>
			</div>
			<UInput
				ref="searchInput"
				v-model="searchDraft"
				icon="i-ph-magnifying-glass"
				size="sm"
				class="w-64"
				:placeholder="t('dms_database.data.grid.search')"
			>
				<template #trailing><UKbd value="/" size="sm" /></template>
			</UInput>
			<div class="ml-auto flex items-center gap-1.5">
				<UTooltip :text="t('dms_database.data.grid.refresh')">
					<UButton
						icon="i-ph-arrows-clockwise"
						color="neutral"
						variant="ghost"
						size="sm"
						:loading="loading"
						:aria-label="t('dms_database.data.grid.refresh')"
						@click="reload"
					/>
				</UTooltip>
				<UButton
					icon="i-ph-code"
					color="neutral"
					variant="ghost"
					size="sm"
					:label="t('dms_database.data.grid.open_query')"
					@click="openInQueryConsole"
				/>
			</div>
		</div>

		<DataFilterBar
			:columns="visibleColumns"
			:filters="state.filters"
			@set="setFilter"
			@clear="clearFilters"
		/>

		<div
			v-if="readOnly"
			class="border-default bg-warning/5 flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm"
		>
			<UIcon name="i-ph-lock-simple" class="text-warning size-4" />
			<span>
				<b>{{ t('dms_database.data.grid.read_only') }}</b>
				<span class="text-muted ml-1">
					{{
						t('dms_database.data.grid.read_only_detail', { table: tab.table })
					}}
				</span>
			</span>
			<span class="ml-auto flex gap-1.5">
				<UButton
					v-for="instance in namedInstances"
					:key="instance"
					size="xs"
					color="neutral"
					variant="outline"
					:label="t('dms_database.data.grid.switch_to', { instance })"
					@click="switchInstance(instance)"
				/>
				<UButton
					size="xs"
					color="neutral"
					variant="outline"
					:label="
						t('dms_database.data.grid.switch_to', {
							instance: t('dms_database.data.scope.default'),
						})
					"
					@click="switchInstance(DEFAULT_INSTANCE_VALUE)"
				/>
			</span>
		</div>

		<div
			ref="scroller"
			class="relative min-h-0 flex-1 scroll-pl-14 scroll-pt-9 overflow-auto outline-none"
			tabindex="0"
			@keydown="onKeydown"
		>
			<table
				v-if="visibleColumns.length > 0 && rows.length > 0"
				class="w-max min-w-full border-separate border-spacing-0"
				style="table-layout: fixed"
			>
				<colgroup>
					<col style="width: 56px" />
					<col
						v-for="column in visibleColumns"
						:key="column.name"
						:style="{ width: `${widthFor(column.name)}px` }"
					/>
				</colgroup>
				<thead class="sticky top-0 z-10">
					<tr>
						<th
							class="border-default bg-elevated sticky left-0 z-20 border-b border-r"
							scope="col"
						/>
						<DataGridHeaderCell
							v-for="column in visibleColumns"
							:key="column.name"
							:column="column"
							:role="roleOf(column)"
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
					<tr v-for="(row, r) in rows" :key="rowKey(row, r)" class="group/row">
						<td
							class="border-default bg-elevated text-dimmed sticky left-0 z-[5] border-b border-r px-1 py-1 text-right font-mono text-[10.5px] tabular-nums"
						>
							<span class="group-hover/row:hidden">
								{{ state.page * state.pageSize + r + 1 }}
							</span>
							<button
								type="button"
								class="text-muted hover:text-primary hidden w-full justify-end group-hover/row:flex"
								:aria-label="t('dms_database.data.grid.open_row')"
								:title="t('dms_database.data.grid.open_row')"
								@click="openRow(r)"
							>
								<UIcon name="i-ph-arrows-out-simple" class="size-3.5" />
							</button>
						</td>
						<DataGridCell
							v-for="(column, c) in visibleColumns"
							:key="column.name"
							:data-cell="`${r}:${c}`"
							:value="row[column.name]"
							:staged="stagedCell(row, column.name)"
							:role="roleOf(column)"
							:editable="isCellEditable(column.name, row)"
							:editing="editing?.r === r && editing?.c === c"
							:invalid="
								editing?.r === r && editing?.c === c
									? (invalidReason ?? undefined)
									: undefined
							"
							:focused="focused?.r === r && focused?.c === c"
							@select="focusCell(r, c)"
							@start-edit="openEditorAt(r, c)"
							@commit="commitCell"
							@cancel="cancelEdit"
						/>
					</tr>
				</tbody>
			</table>

			<div v-if="loadError" class="grid h-full place-items-center p-6">
				<DmsEmptyState
					variant="error"
					:title="
						t('dms_database.data.empty.error_title', { table: tab.table })
					"
					:actions="[
						{
							label: t('dms_database.common.retry'),
							icon: 'i-ph-arrows-clockwise',
							color: 'neutral',
							variant: 'outline',
							onClick: reload,
						},
						{
							label: t('dms_database.data.empty.check_connection'),
							color: 'neutral',
							variant: 'ghost',
							to: DATABASE_PAGES.overview,
						},
					]"
				>
					<p class="text-muted text-sm">
						{{ t('dms_database.data.empty.error_description') }}
					</p>
					<p class="text-dimmed mt-1 font-mono text-[11px]">{{ loadError }}</p>
				</DmsEmptyState>
			</div>
			<div
				v-else-if="!loading && rows.length === 0 && hasRefinements"
				class="grid h-full place-items-center p-6"
			>
				<DmsEmptyState
					variant="no-result"
					:title="t('dms_database.data.empty.no_match_title')"
					:description="
						t('dms_database.data.empty.no_match_description', {
							count: n(total),
							table: tab.table,
						})
					"
					:actions="[
						{
							label: t('dms_database.data.empty.clear_filters'),
							color: 'neutral',
							variant: 'outline',
							onClick: clearRefinements,
						},
						...(readOnly
							? []
							: [
									{
										label: t('dms_database.data.empty.search_all'),
										color: 'neutral' as const,
										variant: 'ghost' as const,
										onClick: () => switchInstance(CROSS_INSTANCE_VALUE),
									},
								]),
					]"
				/>
			</div>
			<div
				v-else-if="!loading && rows.length === 0"
				class="grid h-full place-items-center p-6"
			>
				<DmsEmptyState
					:title="
						t('dms_database.data.empty.no_rows_title', { table: tab.table })
					"
					:description="t('dms_database.data.empty.no_rows_description')"
				/>
			</div>
			<div v-if="loading" class="absolute inset-x-0 top-0">
				<UProgress size="xs" />
			</div>
		</div>

		<div v-if="pendingCount > 0" class="border-default border-t px-3 py-2">
			<DmsSaveBar
				variant="band"
				dirty
				:saving="saving"
				:changes="changedFields"
				:save-label="t('dms_database.data.save.review', pendingCount)"
				@discard="staged.discard(tab.id)"
				@save="review"
			/>
		</div>

		<footer
			class="border-default text-muted flex flex-wrap items-center gap-3 border-t px-3 py-1.5 text-xs"
		>
			<span class="tabular-nums">
				{{ t('dms_database.data.grid.rows', { count: n(total) }, total) }}
			</span>
			<span class="flex items-center gap-1.5">
				{{ t('dms_database.data.grid.page_size') }}
				<USelect
					:model-value="state.pageSize"
					:items="pageSizeOptions"
					size="xs"
					class="w-20"
					@update:model-value="setPageSize(Number($event))"
				/>
			</span>
			<span class="text-dimmed hidden items-center gap-1 2xl:flex">
				<UKbd value="enter" size="sm" />
				{{ t('dms_database.data.grid.kbd_edit') }}
				<UKbd value="esc" size="sm" class="ml-1.5" />
				{{ t('dms_database.data.grid.kbd_cancel') }}
				<UKbd value="space" size="sm" class="ml-1.5" />
				{{ t('dms_database.data.grid.kbd_open') }}
				<UKbd value="meta" size="sm" class="ml-1.5" />
				<UKbd value="s" size="sm" />
				{{ t('dms_database.data.grid.kbd_save') }}
			</span>
			<nav
				class="ml-auto flex items-center gap-1"
				:aria-label="t('dms_database.data.grid.pagination')"
			>
				<span class="mr-2 tabular-nums">{{ pageStart }}–{{ pageEnd }}</span>
				<UButton
					icon="i-ph-caret-left"
					color="neutral"
					variant="ghost"
					size="xs"
					:disabled="state.page === 0"
					:aria-label="t('dms_database.data.grid.previous_page')"
					@click="state.page -= 1"
				/>
				<template v-for="(page, index) in pages" :key="page">
					<span
						v-if="index > 0 && page - (pages[index - 1] ?? page) > 1"
						class="text-dimmed px-1"
					>
						…
					</span>
					<UButton
						size="xs"
						:color="page === state.page ? 'primary' : 'neutral'"
						:variant="page === state.page ? 'soft' : 'ghost'"
						:label="String(page + 1)"
						class="tabular-nums"
						@click="state.page = page"
					/>
				</template>
				<UButton
					icon="i-ph-caret-right"
					color="neutral"
					variant="ghost"
					size="xs"
					:disabled="pageEnd >= total"
					:aria-label="t('dms_database.data.grid.next_page')"
					@click="state.page += 1"
				/>
			</nav>
		</footer>

		<JsonCellPanel
			:open="jsonPanel !== null"
			:column="jsonPanel?.field ?? ''"
			:value="jsonPanel?.value"
			:read-only="jsonPanel?.readOnly ?? true"
			@update:open="jsonPanel = $event ? jsonPanel : null"
			@save="stageJson"
		/>
	</div>
</template>
