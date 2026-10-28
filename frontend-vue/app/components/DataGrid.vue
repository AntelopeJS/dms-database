<script setup lang="ts">
import {
	CROSS_INSTANCE_VALUE,
	DEFAULT_INSTANCE_VALUE,
	useDataBrowserTabs,
} from '../build/composables/useDataBrowserTabs'
import { useDatabaseSchemas } from '../build/composables/useDatabaseSchemas'
import {
	browseListQuery,
	browseSelectionQuery,
	useDataBrowserGrid,
} from '../build/composables/useDataBrowserGrid'
import { onKeyStroke, useEventListener } from '@vueuse/core'
import { parseDraft } from '../build/data/cellValues'
import { useStagedEdits } from '../build/data/stagedEdits'
import { mayMoveRows, withWrittenRow } from '../build/data/stagedWrites'
import { type SavedChanges, useStagedSave } from '../build/data/useStagedSave'
import type { TableSummary } from '../build/composables/useDatabaseSchemas'
import type { BrowserTab } from '../build/composables/useDataBrowserTabs'
import type {
	ColumnFilterState,
	GridColumn,
	GridData,
} from '../build/composables/useDataBrowserGrid'
import { DATABASE_PAGES, tableAccess } from '../build/utils/databaseLinks'
import { type ColumnRole, isPrimaryKey } from '../build/utils/fieldTypes'
import {
	DEFAULT_PRIMARY_KEY,
	columnsOf,
	moveFocus,
	type ColumnsResponse,
	type ListResponse,
} from '../build/data/gridData'
import DataGridEmpty from '../build/components/DataGridEmpty.vue'
import DataGridFooter from '../build/components/DataGridFooter.vue'
import DataGridReadOnlyBanner from '../build/components/DataGridReadOnlyBanner.vue'
import DataGridSaveStatus from '../build/components/DataGridSaveStatus.vue'
import DataGridToolbar from '../build/components/DataGridToolbar.vue'
import DataFilterBar from './DataFilterBar.vue'
import DataGridCell from './DataGridCell.vue'
import DataGridHeaderCell from './DataGridHeaderCell.vue'
import JsonCellPanel from './JsonCellPanel.vue'
import RowDrawer from './RowDrawer.vue'

// The grid of one open table. Rows are read a page at a time; a committed
// cell is staged, not written (D-02): the save bar offers a review of every
// change before it is written, then the save and its undo for a few seconds.
// A row written shows as the server answered it, in place: the page is read
// again only when the write may move rows in or out of it.

const BROWSE_ENDPOINT = '/api/database/browse'
// Browse-only columns: the source instance of a cross-instance read.
const SYNTHETIC_FIELDS = new Set(['_instance'])
const DEFAULT_COLUMN_WIDTH = 180
const SEARCH_DEBOUNCE_MS = 300

const props = defineProps<{
	tab: BrowserTab
	/** The table as introspected: its declared columns and relations. */
	table?: TableSummary
}>()

const { t } = useI18n()
const router = useDmsRouter()
const grid = useDataBrowserGrid()
const staged = useStagedEdits()
const { tabs: browserTabs, pinTab, openTab, replaceTab } = useDataBrowserTabs()
const { open: openDrawer } = useDrawer()
const { schemas } = useDatabaseSchemas()

const state = grid.getState(props.tab.id)
const readOnly = computed(() => props.tab.instance === CROSS_INSTANCE_VALUE)

// --- data loading ---
const selection = computed(() => browseSelectionQuery(props.tab))
// The columns sampled from the table: the table alone decides them. A
// failure leaves the grid on the introspected fields.
const columnsRead = useApiData<ColumnsResponse>(`${BROWSE_ENDPOINT}/columns`, {
	query: selection,
})
// A page of rows, read again as the selection, the page, the sort, the search
// or the filters change; the previous page stays on screen meanwhile.
const listRead = useApiData<ListResponse>(`${BROWSE_ENDPOINT}/list`, {
	query: () => ({ ...selection.value, ...browseListQuery(state) }),
})
const loading = computed(() => listRead.pending.value)
const loadError = computed(() => {
	const error = listRead.error.value
	if (!error) return null
	return error instanceof Error ? error.message : String(error)
})

const data = computed<GridData | null>(() => {
	const list = listRead.data.value
	if (!list) return null
	const meta = columnsRead.data.value
	const primaryKey = list.primaryKey ?? meta?.primaryKey ?? null
	return {
		columns: columnsOf(meta, primaryKey, props.table),
		rows: list.results ?? [],
		total: list.total ?? 0,
		primaryKey,
	}
})

watch(data, (next) => {
	if (!next) return
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
})

function reload() {
	void columnsRead.refresh()
	void listRead.refresh()
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
const toolbar = useTemplateRef<{ focusSearch: () => void }>('toolbar')
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

// The tab moves to the other instance in place; a tab holding staged edits
// keeps them, and the instance opens next to it instead.
function switchInstance(instance: string) {
	if (staged.count(props.tab.id) > 0) {
		openTab(props.tab.schema, instance, props.tab.table, false)
		return
	}
	replaceTab(props.tab.id, props.tab.schema, instance, props.tab.table)
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
	const next = moveFocus(
		event.key,
		current,
		rows.value.length,
		visibleColumns.value.length,
	)
	if (!next) return
	event.preventDefault()
	focusCell(next.r, next.c)
}

// --- inline editing: a commit stages the value ---
const editing = ref<{
	r: number
	c: number
	rowId: string
	field: string
} | null>(null)
const invalidReason = ref<string | null>(null)

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
		openJsonEditor(rowId, column.name, value, !isCellEditable(column.name, row))
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

// A structured cell opens its JSON in a DMS drawer; applying stages it.
function openJsonEditor(
	rowId: string | null,
	field: string,
	value: unknown,
	cellReadOnly: boolean,
) {
	const editor = openDrawer<{ value: unknown } | undefined>({
		direction: 'right',
		component: JsonCellPanel,
		title: t('dms_database.data.json.title', { column: field }),
		componentOptions: { column: field, value, readOnly: cellReadOnly },
	})
	editor.result
		.then((result) => {
			if (result && !cellReadOnly && rowId !== null)
				stage(rowId, field, result.value)
		})
		.finally(refocusGrid)
}

// --- staged changes: review, save, undo ---
const pendingCount = computed(() => staged.count(props.tab.id))
const changedFields = computed(() => [
	...new Set(staged.list(props.tab.id).map((change) => change.field)),
])
// The page on screen, with a row written in place of the one read: the read's
// data is replaced (it is shallow), so the cell shows the stored value at once.
function showWritten(tab: BrowserTab, row: Record<string, unknown>) {
	const list = listRead.data.value
	if (tab.id !== props.tab.id || !list) return
	listRead.data.value = {
		...list,
		results: withWrittenRow(list.results ?? [], row, rowIdOf),
	}
}

// A save may change which rows the page holds, or their order, only through
// the fields it sorts, filters or searches by; a row gone meanwhile leaves.
function afterSave({ fields, gone }: SavedChanges) {
	const filtered = Object.entries(state.filters)
		.filter(([, filter]) => filter.value)
		.map(([field]) => field)
	if (
		gone > 0 ||
		mayMoveRows(fields, {
			sortKey: state.sortKey,
			search: state.search,
			filtered,
		})
	)
		reload()
}

const {
	saving,
	review,
	notice: saveNotice,
	undo,
} = useStagedSave({
	tab: () => props.tab,
	onWritten: showWritten,
	onSaved: afterSave,
})

onKeyStroke('s', (event) => {
	if (!(event.metaKey || event.ctrlKey) || pendingCount.value === 0) return
	event.preventDefault()
	review()
})

// --- the row drawer ---
// The DMS row header (`rowHeader`) names the row and holds its position on
// the page, previous / next and J / K.

/** The position over the rows of the page, "Row 3 of 50". */
const ROW_POSITION_KEY = 'dms_database.data.row.position'

function rowNavigation(index: number): RowNavigation {
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
	const rowId = rowIdOf(row)
	const heading = rowId ?? t('dms_database.data.row.no_id')
	return {
		componentKey: `${props.tab.id}:${rowId ?? index}`,
		title: heading,
		rowHeader: {
			title: heading,
			positionLabel: `$${ROW_POSITION_KEY}`,
			navigation: rowNavigation(index),
		},
		componentOptions: {
			tab: props.tab,
			row,
			rowId,
			columns: visibleColumns.value,
			table: props.table,
			readOnly: readOnly.value,
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

// ⌘ / (Ctrl / elsewhere) focuses the row search, as every DMS page search:
// "/" alone belongs to the navigation search.
useEventListener('keydown', (event: KeyboardEvent) => {
	if (event.key === '/' && (event.metaKey || event.ctrlKey)) {
		event.preventDefault()
		toolbar.value?.focusSearch()
		return
	}
	const target = event.target as HTMLElement | null
	if (target?.closest('input, textarea, select, [contenteditable=true]')) return
	if (event.metaKey || event.ctrlKey || event.altKey) return
	if (event.key === 'r' && !editing.value) reload()
})
</script>

<template>
	<div class="flex flex-1 flex-col md:min-h-0">
		<DataGridToolbar
			ref="toolbar"
			v-model:search="searchDraft"
			:table="tab.table"
			:total="total"
			:loading="loading"
			@reload="reload"
			@open-query="openInQueryConsole"
		/>

		<DataFilterBar
			:columns="visibleColumns"
			:filters="state.filters"
			@set="setFilter"
			@clear="clearFilters"
		/>

		<DataGridReadOnlyBanner
			v-if="readOnly"
			:table="tab.table"
			:instances="namedInstances"
			@switch-instance="switchInstance"
		/>

		<div
			ref="scroller"
			class="relative min-h-80 flex-1 scroll-pl-14 scroll-pt-9 overflow-auto outline-none md:min-h-0"
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
							:column="column.name"
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

			<DataGridEmpty
				:table="tab.table"
				:total="total"
				:load-error="loadError"
				:loading="loading"
				:empty="rows.length === 0"
				:has-refinements="hasRefinements"
				:read-only="readOnly"
				@reload="reload"
				@clear-refinements="clearRefinements"
				@search-all="switchInstance(CROSS_INSTANCE_VALUE)"
			/>
			<div v-if="loading" class="absolute inset-x-0 top-0">
				<UProgress size="xs" />
			</div>
		</div>

		<DataGridSaveStatus
			:pending-count="pendingCount"
			:changed-fields="changedFields"
			:saving="saving"
			:notice="saveNotice"
			@discard="staged.discard(tab.id)"
			@save="review"
			@undo="undo"
		/>

		<DataGridFooter
			v-model:page="state.page"
			v-model:page-size="state.pageSize"
			:total="total"
		/>
	</div>
</template>
