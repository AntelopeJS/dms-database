<script setup lang="ts">
import { useDatabaseSchemas } from '../build/composables/useDatabaseSchemas'
import { useDiagramDrag } from '../build/composables/useDiagramDrag'
import { useDiagramNotes } from '../build/composables/useDiagramNotes'
import { RESET_ZOOM, useDiagramView } from '../build/composables/useDiagramView'
import { useDiagramSaveStatus } from '../build/composables/useDiagramSaveStatus'
import { useDiagramSearch } from '../build/composables/useDiagramSearch'
import { useDiagramPersistence } from '../build/composables/useDiagramPersistence'
import type { NodeMouseEvent, VueFlowStore } from '@vue-flow/core'
import { useEventListener } from '@vueuse/core'
import type { ShallowUnwrapRef } from 'vue'
import { DiagramAutosave } from '../build/diagram/autosave'
import {
	buildGraph,
	type LayoutOptions,
	layOutSchema,
	NOTE_NODE_TYPE,
	neighbourIds,
	RELATION_EDGE_TYPE,
	type Sides,
	STUB_NODE_TYPE,
	TABLE_NODE_TYPE,
	tableNodeId,
} from '../build/diagram/graph'
import {
	clonePositions,
	DiagramHistory,
	type DiagramOperation,
	type DiagramState,
} from '../build/diagram/history'
import {
	canvasOwnsKey,
	type DiagramCommand,
	diagramCommand,
} from '../build/diagram/shortcuts'
import { DiagramSync, noteFromStored } from '../build/diagram/sync'
import DiagramLegend from '../build/components/DiagramLegend.vue'
import DiagramSearchBar from '../build/components/DiagramSearchBar.vue'
import DiagramStatusBar from '../build/components/DiagramStatusBar.vue'
import DiagramToolbar from '../build/components/DiagramToolbar.vue'
import DiagramViewBar from '../build/components/DiagramViewBar.vue'
import DiagramNoteNode from './DiagramNoteNode.vue'
import DiagramRelationEdge from './DiagramRelationEdge.vue'
import DiagramStubNode from './DiagramStubNode.vue'
import DiagramTableNode from './DiagramTableNode.vue'
import TableInspector from './TableInspector.vue'

// The Diagram page: the tables of one schema and their relations. Moving a
// table saves the layout on its own (D-10), with undo and redo; auto layout
// is previewed before it is kept, because it moves every table at once.

const SAVE_DELAY_MS = 800
// Far enough out for a large schema to fit in the view (D-16).
const MIN_ZOOM = 0.1
const NOTE_WIDTH = 220
const NOTE_HEIGHT = 140
// Above this many tables the canvas suggests focusing on one of them.
const LARGE_SCHEMA_TABLES = 40

const { t } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const toast = useToast()
const { schemas, isLoading: schemasLoading } = useDatabaseSchemas()
const persistence = useDiagramPersistence()
const { open: openDrawer } = useDrawer()

const canvas = shallowRef<ShallowUnwrapRef<VueFlowStore> | null>(null)
const canvasWrapper = useTemplateRef<HTMLElement>('canvasWrapper')
const searchBar = useTemplateRef<{ focus: () => void; blur: () => void }>(
	'searchBar',
)

const state = reactive<DiagramState>({ positions: {}, notes: [] })
const history = new DiagramHistory()
const historyRevision = ref(0)
const routing = new Map<string, Sides>()

const selectedId = ref<string | null>(null)
const focusId = ref<string | null>(null)
const panMode = ref(false)
const viewport = ref({ x: 0, y: 0, zoom: RESET_ZOOM })
const preview = ref<{
	from: DiagramState['positions']
	basis: LayoutOptions
} | null>(null)
// Tables showing all their columns, per schema: a view setting of this
// visit, not part of the shared layout.
const expanded = shallowRef(new Set<string>())
const expandedBySchema = new Map<string, Set<string>>()
// The canvas shape and the notes the layout of unsaved tables works around,
// read when the schema loads and when auto layout runs, so a note moved
// later does not move them.
const layoutBasis = shallowRef<LayoutOptions>({})
const loaded = ref(false)
// The note just created, opened ready to write until its edit ends.
const editNoteId = ref<string | null>(null)
let sync: DiagramSync | null = null
let autosave: DiagramAutosave | null = null
const { saveState, savedAt, savedLabel, statusReporter } = useDiagramSaveStatus(
	() => sync,
)

// --- schema ---
const schemaId = computed<string | null>(() => {
	const asked = route.query.schema
	if (typeof asked === 'string' && schemas.value.some((s) => s.id === asked))
		return asked
	return schemas.value[0]?.id ?? null
})
const schema = computed(
	() => schemas.value.find((s) => s.id === schemaId.value) ?? null,
)
const schemaItems = computed(() =>
	schemas.value.map((s) => ({ label: s.id, value: s.id, icon: 'i-ph-stack' })),
)

const { fitAll, startView, centerOn, onNodesInitialized, requestFit } =
	useDiagramView({
		canvas,
		canvasWrapper,
		viewport,
		selectedId,
		schema,
		route,
		router,
		warn,
	})
const {
	addNote,
	changeNoteText,
	deleteNote,
	endNoteEdit,
	onDeleteNodes,
	selectNode,
} = useDiagramNotes({
	state,
	canvas,
	canvasWrapper,
	schema,
	schemaId,
	viewport,
	selectedId,
	editNoteId,
	record,
	render,
})
const { onNodeDragStart, onNodeDragStop } = useDiagramDrag({
	state,
	preview,
	selectedId,
	record,
	render,
	selectNode,
})

// Each schema is a step of the browser history (D-11).
function openSchema(id: string) {
	if (id === schemaId.value) return
	router.push({ query: { ...route.query, schema: id, table: undefined } })
}

/** Opens the table a stub stands for (D-10). */
function openTable(schemaName: string, tableName: string) {
	if (schemaName !== schemaId.value) {
		router.push({
			query: { ...route.query, schema: schemaName, table: tableName },
		})
		return
	}
	const id = tableNodeId(schemaName, tableName)
	if (focusIds.value && !focusIds.value.has(id)) focusId.value = null
	nextTick(() => centerOn(id))
}

function warn(title: string) {
	toast.add({ title, color: 'warning', icon: 'i-ph-warning' })
}

// A schema the URL names that does not exist: say so, and drop it from the
// URL (D-12).
onMounted(() => {
	watch(
		[() => route.query.schema, schemas, schemasLoading],
		() => {
			const asked = route.query.schema
			if (typeof asked !== 'string' || schemasLoading.value) return
			if (!schemas.value.length || schemas.value.some((s) => s.id === asked))
				return
			warn(t('dms_database.diagram.not_found.schema', { schema: asked }))
			router.replace({
				query: { ...route.query, schema: undefined, table: undefined },
			})
		},
		{ immediate: true },
	)
})

// --- graph ---
const focusIds = computed(() =>
	focusId.value && schema.value
		? neighbourIds(schema.value, focusId.value.split('::')[1] ?? '')
		: null,
)

// Where the layout puts every table of the schema: the place of a table
// without a saved one, focused or not (D-4).
const fullLayout = computed(() =>
	schema.value ? layOutSchema(schema.value, layoutBasis.value) : undefined,
)

function currentLayoutBasis(): LayoutOptions {
	const rect = canvasWrapper.value?.getBoundingClientRect()
	return {
		aspect: rect?.width && rect.height ? rect.width / rect.height : undefined,
		obstacles: state.notes.map(({ x, y, width, height }) => ({
			x,
			y,
			width,
			height,
		})),
	}
}

function toggleColumns(tableName: string) {
	const next = new Set(expanded.value)
	if (!next.delete(tableName)) next.add(tableName)
	setExpanded(next)
	render()
}

function setExpanded(next: Set<string>) {
	expanded.value = next
	if (schemaId.value) expandedBySchema.set(schemaId.value, next)
}

function render() {
	if (!canvas.value || !schema.value || !loaded.value) return
	const built = buildGraph({
		schema: schema.value,
		positions: state.positions,
		notes: state.notes,
		selectedId: selectedId.value,
		focusIds: focusIds.value,
		noteHandlers: {
			onTextChange: changeNoteText,
			onDelete: deleteNote,
			onEditEnd: endNoteEdit,
		},
		editNoteId: editNoteId.value,
		onOpenSchema: openTable,
		routing,
		layout: fullLayout.value,
		expanded: expanded.value,
		onToggleColumns: toggleColumns,
	})
	canvas.value.setNodes(built.nodes)
	canvas.value.setEdges(built.edges)
}

watch([canvas, schema, selectedId, focusIds, loaded], render)

const { search, searchIndex, searchMissed, searchPosition, runSearch } =
	useDiagramSearch({
		schema,
		schemaId,
		focusIds,
		focusId,
		expanded,
		setExpanded,
		render,
		centerOn,
	})

// --- loading and saving ---
// An auto layout being previewed is not kept yet: a save writes the layout
// from before it.
function stateToSave(): DiagramState {
	return preview.value
		? { positions: preview.value.from, notes: state.notes }
		: state
}

function scheduleSave() {
	autosave?.schedule()
}

function saveNow() {
	autosave?.schedule()
	void autosave?.flush()
}

async function load(id: string) {
	// What is left of the shown schema's changes is copied now and written
	// under its own id before the next schema loads (D-2).
	const leaving = autosave?.flush()
	autosave = null
	loaded.value = false
	routing.clear()
	history.clear()
	historyRevision.value++
	preview.value = null
	selectedId.value = null
	focusId.value = null
	editNoteId.value = null
	searchIndex.value = -1
	const owner = new DiagramSync(persistence, id)
	sync = owner
	await leaving
	if (sync !== owner) return
	try {
		const stored = await persistence.readDiagram(id)
		if (sync !== owner) return
		state.positions = stored.positions
		state.notes = stored.notes.map(noteFromStored)
	} catch {
		if (sync !== owner) return
		state.positions = {}
		state.notes = []
	}
	expanded.value = expandedBySchema.get(id) ?? new Set()
	layoutBasis.value = currentLayoutBasis()
	owner.reset(state)
	autosave = new DiagramAutosave(
		owner,
		stateToSave,
		SAVE_DELAY_MS,
		statusReporter(owner),
	)
	saveState.value = 'idle'
	savedAt.value = null
	requestFit()
	loaded.value = true
}

// The canvas is drawn in the browser, from a working copy of the layout and
// notes it reads there: a server render, which would read them without
// handing them over, never starts it.
onMounted(() => watch(schemaId, (id) => id && load(id), { immediate: true }))

function record(op: DiagramOperation) {
	history.push(op)
	historyRevision.value++
	scheduleSave()
}

onBeforeUnmount(() => void autosave?.flush())

// --- undo / redo ---
const canUndo = computed(
	() => historyRevision.value >= 0 && history.canUndo && !preview.value,
)
const canRedo = computed(
	() => historyRevision.value >= 0 && history.canRedo && !preview.value,
)

function undo() {
	if (!canUndo.value || !history.undo(state)) return
	historyRevision.value++
	render()
	scheduleSave()
}

function redo() {
	if (!canRedo.value || !history.redo(state)) return
	historyRevision.value++
	render()
	scheduleSave()
}

// --- auto layout, previewed before it is kept ---
const movedCount = computed(() => {
	if (!preview.value || !schema.value) return 0
	return schema.value.tables.filter((table) => {
		// A table without a saved position already sat where the layout puts it.
		const before = preview.value?.from[table.name]
		const after = state.positions[table.name]
		return Boolean(
			before && after && (before.x !== after.x || before.y !== after.y),
		)
	}).length
})

function startAutoLayout() {
	if (!fullLayout.value || preview.value) return
	preview.value = {
		from: clonePositions(state.positions),
		basis: layoutBasis.value,
	}
	// Laid out for the canvas and the notes as they are now.
	layoutBasis.value = currentLayoutBasis()
	state.positions = clonePositions(fullLayout.value.tables)
	routing.clear()
	render()
	nextTick(startView)
}

function keepLayout() {
	if (!preview.value) return
	const from = preview.value.from
	preview.value = null
	record({ kind: 'layout', from, to: clonePositions(state.positions) })
}

function discardLayout() {
	if (!preview.value) return
	state.positions = preview.value.from
	// Unsaved tables go back where they were before the preview.
	layoutBasis.value = preview.value.basis
	preview.value = null
	render()
}

// --- selection and inspection ---
function onNodeClick({ node }: NodeMouseEvent) {
	if (node.type === STUB_NODE_TYPE) return
	selectedId.value = node.type === TABLE_NODE_TYPE ? node.id : null
}

function onPaneClick() {
	selectedId.value = null
}

// The drawer is titled with the table it shows, as the Schemas page's; a
// relation the inspector follows shows its table in the same drawer. No
// position nor J / K: the diagram's tables are not a list.
let inspector: ReturnType<typeof openDrawer> | null = null

function inspectorOptions(schema: string, name: string) {
	return {
		componentKey: `${schema}::${name}`,
		title: name,
		componentOptions: {
			rowData: { schema, name },
			showRow: async (row: object | string) => {
				if (typeof row !== 'string') throw new Error('not a table id')
				const [toSchema = '', toName = ''] = row.split('::')
				inspector?.patch(inspectorOptions(toSchema, toName))
			},
		},
	}
}

function inspect(tableName: string) {
	if (!schemaId.value) return
	inspector = openDrawer({
		direction: 'right',
		component: TableInspector,
		...inspectorOptions(schemaId.value, tableName),
	})
	inspector.result.finally(() => {
		inspector = null
	})
}

function onNodeDoubleClick({ node }: NodeMouseEvent) {
	if (node.type !== TABLE_NODE_TYPE) return
	inspect((node.data as { tableName: string }).tableName)
}

const selectedTable = computed(() => selectedId.value?.split('::')[1] ?? null)

function toggleFocus() {
	focusId.value = focusId.value ? null : selectedId.value
	render()
	nextTick(fitAll)
}

function leaveSearch() {
	searchBar.value?.blur()
}

// --- viewport ---
const zoomPercent = computed(() => `${Math.round(viewport.value.zoom * 100)}%`)

function onViewportChange(next: { x: number; y: number; zoom: number }) {
	viewport.value = { ...next }
}

// --- keyboard: the shortcuts the toolbar's tooltips name ---
// Escape steps back one level: the auto layout preview, then the focus,
// then the selection (D-14).
function escape(): boolean {
	if (preview.value) {
		discardLayout()
		return true
	}
	if (focusId.value) {
		toggleFocus()
		return true
	}
	const selectedNotes = canvas.value?.getSelectedNodes ?? []
	if (!selectedId.value && !selectedNotes.length) return false
	selectedId.value = null
	canvas.value?.removeSelectedNodes(selectedNotes)
	return true
}

function always(run: () => unknown): () => boolean {
	return () => {
		run()
		return true
	}
}

const COMMANDS: Record<DiagramCommand, () => boolean> = {
	search: always(() => searchBar.value?.focus()),
	note: always(() => !isEmpty.value && addNote()),
	select: always(() => (panMode.value = false)),
	pan: always(() => (panMode.value = true)),
	fit: always(fitAll),
	resetZoom: always(() => canvas.value?.zoomTo(RESET_ZOOM)),
	undo: always(undo),
	redo: always(redo),
	escape,
}

// Keys reach the canvas only from the canvas or the page itself: not while
// typing, and not while a dialog such as the inspector is open (D-6).
useEventListener('keydown', (event: KeyboardEvent) => {
	const command = diagramCommand(event)
	if (!command || event.defaultPrevented) return
	if (!canvasOwnsKey(event.target, canvasWrapper.value)) return
	if (COMMANDS[command]()) event.preventDefault()
})

// Imported, not resolved by name: the edge must mount in the SVG namespace,
// which an async global component does not.
const nodeTypes = markRaw({
	[TABLE_NODE_TYPE]: DiagramTableNode,
	[STUB_NODE_TYPE]: DiagramStubNode,
	[NOTE_NODE_TYPE]: DiagramNoteNode,
})
const edgeTypes = markRaw({ [RELATION_EDGE_TYPE]: DiagramRelationEdge })

const isEmpty = computed(
	() => loaded.value && (schema.value?.tables.length ?? 0) === 0,
)
const isLarge = computed(
	() =>
		!focusId.value && (schema.value?.tables.length ?? 0) > LARGE_SCHEMA_TABLES,
)
</script>

<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<DmsEmptyState
			v-if="!schemasLoading && schemas.length === 0"
			class="flex-1"
			icon="i-ph-graph"
			hatched
			:title="t('dms_database.diagram.empty.no_schema')"
		/>
		<DmsClientOnly v-else>
			<div
				ref="canvasWrapper"
				class="border-default relative min-h-0 flex-1 overflow-hidden rounded-xl border"
				:class="panMode ? 'diagram-pan-mode' : ''"
			>
				<!-- Notes carry their own delete button, named in the page's
				     language: the canvas's generic badge would only repeat it. -->
				<DmsFlowCanvas
					ref="canvas"
					:node-types="nodeTypes"
					:edge-types="edgeTypes"
					:controls="false"
					:fit-view-on-init="false"
					:min-zoom="MIN_ZOOM"
					minimap
					deletable-nodes
					:delete-badge="false"
					:pan-on-drag="panMode"
					:nodes-draggable="!panMode"
					:select-nodes-on-drag="false"
					@delete-nodes="onDeleteNodes"
					@nodes-initialized="onNodesInitialized"
					@viewport-change="onViewportChange"
					@node-drag-start="onNodeDragStart"
					@node-drag-stop="onNodeDragStop"
					@node-click="onNodeClick"
					@node-double-click="onNodeDoubleClick"
					@pane-click="onPaneClick"
				>
					<template #top-left>
						<DiagramSearchBar
							ref="searchBar"
							v-model:search="search"
							:schema-id="schemaId"
							:schema-items="schemaItems"
							:search-missed="searchMissed"
							:search-position="searchPosition"
							@open-schema="openSchema"
							@run-search="runSearch"
							@leave-search="leaveSearch"
						/>
					</template>

					<template #top-right>
						<DiagramToolbar
							:save-state="saveState"
							:saved-label="savedLabel"
							:can-undo="canUndo"
							:can-redo="canRedo"
							:auto-layout-disabled="Boolean(preview) || isEmpty"
							@save-now="saveNow"
							@undo="undo"
							@redo="redo"
							@auto-layout="startAutoLayout"
						/>
					</template>

					<template #top-center>
						<DiagramStatusBar
							:preview="Boolean(preview)"
							:moved-count="movedCount"
							:selected-table="selectedTable"
							:focus-id="focusId"
							:is-large="isLarge"
							:table-count="schema?.tables.length ?? 0"
							@discard-layout="discardLayout"
							@keep-layout="keepLayout"
							@inspect="inspect"
							@toggle-focus="toggleFocus"
						/>
					</template>

					<template #bottom-left>
						<DiagramLegend />
					</template>

					<template #bottom-center>
						<DiagramViewBar
							v-model:pan-mode="panMode"
							:zoom-percent="zoomPercent"
							:is-empty="isEmpty"
							@zoom-out="canvas?.zoomOut()"
							@reset-zoom="canvas?.zoomTo(RESET_ZOOM)"
							@zoom-in="canvas?.zoomIn()"
							@fit="fitAll"
							@add-note="addNote"
						/>
					</template>
				</DmsFlowCanvas>

				<div
					v-if="isEmpty"
					class="pointer-events-none absolute inset-0 grid place-items-center"
				>
					<DmsEmptyState
						class="pointer-events-auto"
						icon="i-ph-graph"
						:title="t('dms_database.diagram.empty.title', { schema: schemaId })"
						:description="t('dms_database.diagram.empty.description')"
					/>
				</div>
			</div>
		</DmsClientOnly>
	</div>
</template>

<style scoped>
.diagram-pan-mode :deep(.vue-flow__pane) {
	cursor: grab;
}
.diagram-pan-mode :deep(.vue-flow__pane.dragging) {
	cursor: grabbing;
}
:deep(.vue-flow__minimap) {
	border: 1px solid var(--ui-border-accented);
	border-radius: calc(var(--ui-radius) * 0.75);
	background: var(--ui-bg-elevated);
	overflow: hidden;
}
:deep(.vue-flow__minimap-node) {
	fill: var(--ui-border-accented);
}
/* Below md the overview gives its room to the canvas, as the legend does. */
@media (max-width: 767.98px) {
	:deep(.vue-flow__minimap) {
		display: none;
	}
}
</style>
