<script setup lang="ts">
import { useDatabaseSchemas } from '../build/composables/useDatabaseSchemas'
import { useDiagramPersistence } from '../build/composables/useDiagramPersistence'
import type {
	NodeDragEvent,
	NodeMouseEvent,
	VueFlowStore,
} from '@vue-flow/core'
import { useEventListener, useNow } from '@vueuse/core'
import type { ShallowUnwrapRef } from 'vue'
import { DiagramAutosave, type SaveStatus } from '../build/diagram/autosave'
import {
	buildGraph,
	type DiagramNode,
	freeSpot,
	layOutSchema,
	NODE_WIDTH,
	nodeHeight,
	NOTE_NODE_TYPE,
	type NoteDraft,
	neighbourIds,
	noteNodeId,
	RELATION_EDGE_TYPE,
	type Rect,
	type Sides,
	STUB_NODE_TYPE,
	searchTables,
	TABLE_NODE_TYPE,
	type TableNodeData,
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
import DiagramNoteNode from './DiagramNoteNode.vue'
import DiagramRelationEdge from './DiagramRelationEdge.vue'
import DiagramStubNode from './DiagramStubNode.vue'
import DiagramTableNode from './DiagramTableNode.vue'
import TableInspector from './TableInspector.vue'

// The Diagram page: the tables of one schema and their relations. Moving a
// table saves the layout on its own (D-10), with undo and redo; auto layout
// is previewed before it is kept, because it moves every table at once.

const SAVE_DELAY_MS = 800
const RESET_ZOOM = 1
// Far enough out for a large schema to fit in the view (D-16).
const MIN_ZOOM = 0.1
const NOTE_WIDTH = 220
const NOTE_HEIGHT = 140
const MINUTE_MS = 60_000
// Room around the tables for the floating toolbars.
const FIT_PADDING = 0.25
// Above this many tables the canvas suggests focusing on one of them.
const LARGE_SCHEMA_TABLES = 40
const SEARCH_HINT_ID = 'diagram-search-hint'

const { t } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const toast = useToast()
const { schemas, isLoading: schemasLoading } = useDatabaseSchemas()
const persistence = useDiagramPersistence()
const { open: openDrawer } = useDrawer()
const now = useNow({ interval: MINUTE_MS / 2 })

const canvas = shallowRef<ShallowUnwrapRef<VueFlowStore> | null>(null)
const canvasWrapper = useTemplateRef<HTMLElement>('canvasWrapper')
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement }>(
	'searchInput',
)

const state = reactive<DiagramState>({ positions: {}, notes: [] })
const history = new DiagramHistory()
const historyRevision = ref(0)
const routing = new Map<string, Sides>()

const selectedId = ref<string | null>(null)
const focusId = ref<string | null>(null)
const panMode = ref(false)
const search = ref('')
const searchIndex = ref(-1)
const viewport = ref({ x: 0, y: 0, zoom: RESET_ZOOM })
const preview = ref<{ from: DiagramState['positions'] } | null>(null)
const saveState = ref<SaveStatus>('idle')
const savedAt = ref<Date | null>(null)
const loaded = ref(false)
// The note just created, opened ready to write until its edit ends.
const editNoteId = ref<string | null>(null)
let sync: DiagramSync | null = null
let autosave: DiagramAutosave | null = null
let fitPending = true

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

// Where dagre puts every table of the schema: the place of a table without a
// saved one, focused or not (D-4).
const fullLayout = computed(() =>
	schema.value ? layOutSchema(schema.value) : undefined,
)

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
	})
	canvas.value.setNodes(built.nodes)
	canvas.value.setEdges(built.edges)
}

// The nodes have been measured: the first fit, or the one a schema change or
// a focus asks for, can frame them.
function onNodesInitialized() {
	if (!fitPending) return
	fitPending = false
	if (!centerOnQueryTable()) fitAll()
}

function fitAll() {
	canvas.value?.fitView({ padding: FIT_PADDING, maxZoom: RESET_ZOOM })
}

watch([canvas, schema, selectedId, focusIds, loaded], render)

// --- loading and saving ---
// An auto layout being previewed is not kept yet: a save writes the layout
// from before it.
function stateToSave(): DiagramState {
	return preview.value
		? { positions: preview.value.from, notes: state.notes }
		: state
}

/** Shows the save status of the schema shown; a schema left reports a failure. */
function statusReporter(owner: DiagramSync) {
	return (status: SaveStatus) => {
		if (owner === sync) {
			saveState.value = status
			if (status === 'saved') savedAt.value = new Date()
			return
		}
		// The save of a schema left before it ended.
		if (status === 'error') {
			toast.add({
				title: t('dms_database.diagram.save.error_other', {
					schema: owner.schemaId,
				}),
				color: 'error',
				icon: 'i-ph-warning-circle',
			})
		}
	}
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
		const [positions, notes] = await Promise.all([
			persistence.fetchLayout(id),
			persistence.fetchNotes(id),
		])
		if (sync !== owner) return
		state.positions = positions
		state.notes = notes.map(noteFromStored)
	} catch {
		if (sync !== owner) return
		state.positions = {}
		state.notes = []
	}
	owner.reset(state)
	autosave = new DiagramAutosave(
		owner,
		stateToSave,
		SAVE_DELAY_MS,
		statusReporter(owner),
	)
	saveState.value = 'idle'
	savedAt.value = null
	fitPending = true
	loaded.value = true
}

watch(schemaId, (id) => id && load(id), { immediate: true })

function record(op: DiagramOperation) {
	history.push(op)
	historyRevision.value++
	scheduleSave()
}

onBeforeUnmount(() => void autosave?.flush())

const savedLabel = computed(() => {
	if (saveState.value === 'saving') return t('dms_database.diagram.save.saving')
	if (saveState.value === 'error') return t('dms_database.diagram.save.error')
	if (!savedAt.value) return t('dms_database.diagram.save.idle')
	const minutes = Math.round(
		(now.value.getTime() - savedAt.value.getTime()) / MINUTE_MS,
	)
	return minutes < 1
		? t('dms_database.diagram.save.just_now')
		: t('dms_database.diagram.save.minutes', { count: minutes })
})

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
		// A table without a saved position already sat where dagre puts it.
		const before = preview.value?.from[table.name]
		const after = state.positions[table.name]
		return Boolean(
			before && after && (before.x !== after.x || before.y !== after.y),
		)
	}).length
})

function startAutoLayout() {
	if (!fullLayout.value || preview.value) return
	preview.value = { from: clonePositions(state.positions) }
	state.positions = clonePositions(fullLayout.value.tables)
	routing.clear()
	render()
	nextTick(fitAll)
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
	preview.value = null
	render()
}

// --- dragging ---
const dragStarts = new Map<string, { x: number; y: number }>()

// With `select-nodes-on-drag` off, Vue Flow lets go of the selection when a
// node not selected is grabbed, so a note left selected does not follow a
// table, which Vue Flow cannot select.
function onNodeDragStart({ node, nodes }: NodeDragEvent) {
	for (const dragged of nodes.length ? nodes : [node])
		dragStarts.set(dragged.id, { ...dragged.position })
}

function tableMoved(node: DiagramNode, from: { x: number; y: number }) {
	const tableName = (node.data as { tableName: string }).tableName
	const to = { x: node.position.x, y: node.position.y }
	state.positions[tableName] = to
	if (preview.value) return
	record({ kind: 'tableMove', tableName, from, to })
}

function noteMoved(node: DiagramNode, from: { x: number; y: number }) {
	const noteId = (node.data as { noteId: string }).noteId
	const to = { x: node.position.x, y: node.position.y }
	const note = state.notes.find((n) => n.id === noteId)
	if (!note) return
	Object.assign(note, to)
	record({ kind: 'noteMove', noteId, from, to })
}

const DRAG_HANDLERS: Record<
	string,
	(node: DiagramNode, from: { x: number; y: number }) => void
> = {
	[TABLE_NODE_TYPE]: tableMoved,
	[NOTE_NODE_TYPE]: noteMoved,
}

function onNodeDragStop({ node, nodes }: NodeDragEvent) {
	for (const dragged of nodes.length ? nodes : [node]) {
		const from = dragStarts.get(dragged.id)
		dragStarts.delete(dragged.id)
		const { x, y } = dragged.position
		if (!from || (from.x === x && from.y === y)) continue
		DRAG_HANDLERS[dragged.type ?? '']?.(dragged as unknown as DiagramNode, from)
	}
	// The node put down becomes the selection: a table through
	// `data.selected` (D-9), a note through Vue Flow. Set once the drag is
	// over, as setting the nodes during it would put the dragged one back.
	selectedId.value = node.type === TABLE_NODE_TYPE ? node.id : null
	if (node.type === NOTE_NODE_TYPE && !node.selected) selectNode(node.id)
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

function inspect(tableName: string) {
	if (!schemaId.value) return
	openDrawer({
		title: t('dms_database.schemas.inspector.title'),
		direction: 'right',
		component: TableInspector,
		componentOptions: {
			rowData: { schema: schemaId.value, name: tableName },
		},
	})
}

function onNodeDoubleClick({ node }: NodeMouseEvent) {
	if (node.type !== TABLE_NODE_TYPE) return
	inspect((node.data as { tableName: string }).tableName)
}

function centerOn(nodeId: string): boolean {
	const node = canvas.value?.findNode(nodeId)
	if (!node) return false
	selectedId.value = nodeId
	canvas.value?.setCenter(
		node.position.x + NODE_WIDTH / 2,
		node.position.y + 120,
		{
			zoom: Math.max(viewport.value.zoom, RESET_ZOOM),
			duration: 300,
		},
	)
	return true
}

// The table the URL names; one that does not exist is reported and dropped
// from the URL (D-12).
function centerOnQueryTable(): boolean {
	const table = route.query.table
	const asked = route.query.schema
	if (typeof table !== 'string' || !schema.value) return false
	if (typeof asked === 'string' && asked !== schema.value.id) return false
	if (!schema.value.tables.some((entry) => entry.name === table)) {
		warn(
			t('dms_database.diagram.not_found.table', {
				schema: schema.value.id,
				table,
			}),
		)
		router.replace({ query: { ...route.query, table: undefined } })
		return false
	}
	return centerOn(tableNodeId(schema.value.id, table))
}

const selectedTable = computed(() => selectedId.value?.split('::')[1] ?? null)

function toggleFocus() {
	focusId.value = focusId.value ? null : selectedId.value
	render()
	nextTick(fitAll)
}

// --- search: a table or a column; Enter goes from match to match (D-13) ---
const searchMatches = computed(() =>
	schema.value ? searchTables(schema.value, search.value) : [],
)
const searchMissed = computed(
	() => search.value.trim() !== '' && searchMatches.value.length === 0,
)
const searchPosition = computed(() =>
	searchIndex.value >= 0 && searchMatches.value.length > 1
		? `${searchIndex.value + 1}/${searchMatches.value.length}`
		: null,
)

// Synchronous: an Enter right after the text changed starts from the first
// match of the new text.
watch(
	search,
	() => {
		searchIndex.value = -1
	},
	{ flush: 'sync' },
)

function runSearch() {
	const matches = searchMatches.value
	if (!matches.length || !schemaId.value) return
	searchIndex.value = (searchIndex.value + 1) % matches.length
	const id = tableNodeId(schemaId.value, matches[searchIndex.value] ?? '')
	if (focusIds.value && !focusIds.value.has(id)) focusId.value = null
	nextTick(() => centerOn(id))
}

function leaveSearch() {
	searchInput.value?.inputRef?.blur()
}

// --- notes ---
// What a new note should not cover: the tables drawn, and every note. Sizes
// come from the schema and the notes, as a node just added is not measured.
function takenRects(): Rect[] {
	const tables = (canvas.value?.getNodes ?? []).flatMap((node) => {
		if (node.type !== TABLE_NODE_TYPE) return []
		const { table } = node.data as TableNodeData
		return [
			{
				x: node.position.x,
				y: node.position.y,
				width: NODE_WIDTH,
				height: nodeHeight(table),
			},
		]
	})
	return [...tables, ...state.notes]
}

function selectNode(nodeId: string) {
	const flow = canvas.value
	const node = flow?.findNode(nodeId)
	if (!flow || !node) return
	flow.removeSelectedNodes(flow.getSelectedNodes)
	flow.addSelectedNodes([node])
}

// A new note goes in the free space nearest the centre of the view, above
// the tables, selected and ready to write (D-8).
function addNote() {
	if (!schemaId.value) return
	const rect = canvasWrapper.value?.getBoundingClientRect()
	const { x, y, zoom } = viewport.value
	const centre = {
		x: ((rect?.width ?? 800) / 2 - x) / zoom - NOTE_WIDTH / 2,
		y: ((rect?.height ?? 600) / 2 - y) / zoom - NOTE_HEIGHT / 2,
	}
	const spot = freeSpot(
		centre,
		{ width: NOTE_WIDTH, height: NOTE_HEIGHT },
		takenRects(),
	)
	const note: NoteDraft = {
		id: `temp-${Date.now()}`,
		schemaName: schemaId.value,
		text: '',
		x: Math.round(spot.x),
		y: Math.round(spot.y),
		width: NOTE_WIDTH,
		height: NOTE_HEIGHT,
		color: null,
		isTemp: true,
	}
	state.notes.push(note)
	record({ kind: 'noteCreate', snapshot: { ...note } })
	editNoteId.value = note.id
	selectedId.value = null
	render()
	nextTick(() => selectNode(noteNodeId(note.id)))
}

function changeNoteText(noteId: string, text: string) {
	const note = state.notes.find((n) => n.id === noteId)
	if (!note || note.text === text) return
	record({ kind: 'noteText', noteId, from: note.text, to: text })
	note.text = text
	render()
}

function endNoteEdit(noteId: string) {
	if (editNoteId.value !== noteId) return
	editNoteId.value = null
	render()
}

function deleteNote(noteId: string) {
	const note = state.notes.find((n) => n.id === noteId)
	if (!note) return
	state.notes = state.notes.filter((n) => n.id !== noteId)
	if (editNoteId.value === noteId) editNoteId.value = null
	record({ kind: 'noteDelete', snapshot: { ...note } })
	render()
}

// Delete or Backspace on the canvas: only notes go, with undo (D-3).
function onDeleteNodes(ids: string[]) {
	const doomed = new Set(ids)
	for (const note of [...state.notes]) {
		if (doomed.has(noteNodeId(note.id))) deleteNote(note.id)
	}
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
	search: always(() => searchInput.value?.inputRef?.focus()),
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
						<div class="flex flex-col items-start gap-1.5">
							<div class="diagram-float">
								<USelect
									:model-value="schemaId ?? undefined"
									:items="schemaItems"
									icon="i-ph-stack"
									variant="ghost"
									size="sm"
									class="min-w-36 font-mono"
									:aria-label="t('dms_database.diagram.schema')"
									@update:model-value="openSchema(String($event))"
								/>
								<span class="diagram-float__sep" />
								<UInput
									ref="searchInput"
									v-model="search"
									icon="i-ph-magnifying-glass"
									variant="ghost"
									size="sm"
									class="w-40 md:w-64"
									:color="searchMissed ? 'error' : 'primary'"
									:highlight="searchMissed"
									:placeholder="t('dms_database.diagram.search')"
									:aria-label="t('dms_database.diagram.search')"
									:aria-invalid="searchMissed || undefined"
									:aria-describedby="searchMissed ? SEARCH_HINT_ID : undefined"
									@keydown.enter.prevent="runSearch"
									@keydown.escape.prevent="leaveSearch"
								>
									<template #trailing>
										<span
											v-if="searchPosition"
											class="text-dimmed font-mono text-[11px] tabular-nums"
										>
											{{ searchPosition }}
										</span>
										<UKbd value="F" size="sm" />
									</template>
								</UInput>
							</div>
							<p
								v-if="searchMissed"
								:id="SEARCH_HINT_ID"
								role="status"
								class="diagram-float text-error px-3 py-1 text-xs"
							>
								{{ t('dms_database.diagram.search_empty') }}
							</p>
						</div>
					</template>

					<template #top-right>
						<div class="diagram-float">
							<span
								class="flex items-center gap-1.5 px-2 font-mono text-[11.5px]"
								:class="saveState === 'error' ? 'text-error' : 'text-dimmed'"
								:title="savedLabel"
								role="status"
							>
								<UIcon
									:name="
										saveState === 'error'
											? 'i-ph-warning-circle'
											: saveState === 'saving'
												? 'i-ph-circle-notch'
												: 'i-ph-check-circle'
									"
									class="size-3.5"
									:class="[
										saveState === 'saving' ? 'animate-spin' : '',
										saveState === 'error' ? '' : 'text-success',
									]"
								/>
								<span class="sr-only md:not-sr-only">{{ savedLabel }}</span>
							</span>
							<UButton
								v-if="saveState === 'error'"
								size="xs"
								color="error"
								variant="soft"
								:label="t('dms_database.common.retry')"
								@click="saveNow"
							/>
							<span class="diagram-float__sep" />
							<UTooltip
								:text="t('dms_database.diagram.toolbar.undo')"
								:kbds="['meta', 'z']"
							>
								<UButton
									size="sm"
									color="neutral"
									variant="ghost"
									icon="i-ph-arrow-counter-clockwise"
									:aria-label="t('dms_database.diagram.toolbar.undo')"
									:disabled="!canUndo"
									@click="undo"
								/>
							</UTooltip>
							<UTooltip
								:text="t('dms_database.diagram.toolbar.redo')"
								:kbds="['meta', 'shift', 'z']"
							>
								<UButton
									size="sm"
									color="neutral"
									variant="ghost"
									icon="i-ph-arrow-clockwise"
									:aria-label="t('dms_database.diagram.toolbar.redo')"
									:disabled="!canRedo"
									@click="redo"
								/>
							</UTooltip>
							<span class="diagram-float__sep" />
							<UTooltip
								:text="t('dms_database.diagram.toolbar.auto_layout_hint')"
							>
								<UButton
									size="sm"
									color="neutral"
									variant="ghost"
									icon="i-ph-squares-four"
									:aria-label="t('dms_database.diagram.toolbar.auto_layout')"
									:disabled="Boolean(preview) || isEmpty"
									@click="startAutoLayout"
								>
									<span class="hidden md:inline">
										{{ t('dms_database.diagram.toolbar.auto_layout') }}
									</span>
								</UButton>
							</UTooltip>
						</div>
					</template>

					<template #top-center>
						<div
							v-if="preview"
							class="diagram-float border-primary/40 mt-12 gap-2 py-1.5 pl-3 pr-1.5 text-sm"
						>
							<UIcon name="i-ph-squares-four" class="text-primary size-4" />
							<span>{{ t('dms_database.diagram.preview.title') }}</span>
							<span class="text-muted mr-1">
								{{ t('dms_database.diagram.preview.moved', movedCount) }}
							</span>
							<UButton
								size="sm"
								color="neutral"
								variant="ghost"
								:label="t('dms_database.diagram.preview.discard')"
								@click="discardLayout"
							/>
							<UButton
								size="sm"
								icon="i-ph-check"
								:label="t('dms_database.diagram.preview.keep')"
								@click="keepLayout"
							/>
						</div>
						<div
							v-else-if="selectedTable || focusId"
							class="diagram-float mt-12 gap-1 py-1 pl-3 pr-1 text-sm"
						>
							<UIcon name="i-ph-table" class="text-primary size-4" />
							<span class="font-mono text-[12.5px]">
								{{ selectedTable ?? focusId?.split('::')[1] }}
							</span>
							<span class="diagram-float__sep" />
							<UButton
								v-if="selectedTable"
								size="xs"
								color="neutral"
								variant="ghost"
								icon="i-ph-sidebar-simple"
								:label="t('dms_database.diagram.selection.inspect')"
								@click="inspect(selectedTable)"
							/>
							<UButton
								size="xs"
								color="neutral"
								:variant="focusId ? 'soft' : 'ghost'"
								icon="i-ph-crosshair"
								:label="
									focusId
										? t('dms_database.diagram.selection.show_all')
										: t('dms_database.diagram.selection.focus')
								"
								@click="toggleFocus"
							/>
						</div>
						<div
							v-else-if="isLarge"
							class="diagram-float text-warning mt-12 gap-2 px-3 py-2 text-sm"
						>
							<UIcon name="i-ph-warning" class="size-4" />
							{{
								t('dms_database.diagram.large', {
									count: schema?.tables.length ?? 0,
								})
							}}
						</div>
					</template>

					<template #bottom-left>
						<div class="diagram-legend">
							<span>
								<UIcon name="i-ph-key" class="text-warning" />
								{{ t('dms_database.diagram.legend.key') }}
							</span>
							<span>
								<UIcon name="i-ph-arrow-right" class="text-primary" />
								{{ t('dms_database.diagram.legend.relation') }}
							</span>
							<span>
								<UIcon name="i-ph-brackets-curly" />
								{{ t('dms_database.diagram.legend.object') }}
							</span>
							<span>
								<UIcon name="i-ph-lock-key" />
								{{ t('dms_database.modifiers.encrypted') }}
							</span>
						</div>
					</template>

					<template #bottom-center>
						<div class="diagram-float">
							<UTooltip
								:text="t('dms_database.diagram.toolbar.select')"
								:kbds="['v']"
							>
								<UButton
									size="sm"
									icon="i-ph-cursor"
									:color="panMode ? 'neutral' : 'primary'"
									:variant="panMode ? 'ghost' : 'soft'"
									:aria-pressed="!panMode"
									:aria-label="t('dms_database.diagram.toolbar.select')"
									@click="panMode = false"
								/>
							</UTooltip>
							<UTooltip
								:text="t('dms_database.diagram.toolbar.pan')"
								:kbds="['h']"
							>
								<UButton
									size="sm"
									icon="i-ph-hand"
									:color="panMode ? 'primary' : 'neutral'"
									:variant="panMode ? 'soft' : 'ghost'"
									:aria-pressed="panMode"
									:aria-label="t('dms_database.diagram.toolbar.pan')"
									@click="panMode = true"
								/>
							</UTooltip>
							<span class="diagram-float__sep" />
							<UTooltip :text="t('dms_database.diagram.toolbar.zoom_out')">
								<UButton
									size="sm"
									color="neutral"
									variant="ghost"
									icon="i-ph-magnifying-glass-minus"
									:aria-label="t('dms_database.diagram.toolbar.zoom_out')"
									@click="canvas?.zoomOut()"
								/>
							</UTooltip>
							<UTooltip
								:text="t('dms_database.diagram.toolbar.reset_zoom')"
								:kbds="['0']"
							>
								<button
									type="button"
									class="text-muted hover:text-highlighted hover:bg-elevated min-w-12 rounded-md px-2 font-mono text-[11.5px] tabular-nums"
									:aria-label="t('dms_database.diagram.toolbar.reset_zoom')"
									@click="canvas?.zoomTo(RESET_ZOOM)"
								>
									{{ zoomPercent }}
								</button>
							</UTooltip>
							<UTooltip :text="t('dms_database.diagram.toolbar.zoom_in')">
								<UButton
									size="sm"
									color="neutral"
									variant="ghost"
									icon="i-ph-magnifying-glass-plus"
									:aria-label="t('dms_database.diagram.toolbar.zoom_in')"
									@click="canvas?.zoomIn()"
								/>
							</UTooltip>
							<UTooltip
								:text="t('dms_database.diagram.toolbar.fit')"
								:kbds="['1']"
							>
								<UButton
									size="sm"
									color="neutral"
									variant="ghost"
									icon="i-ph-arrows-out"
									:aria-label="t('dms_database.diagram.toolbar.fit')"
									@click="fitAll"
								/>
							</UTooltip>
							<span class="diagram-float__sep" />
							<UTooltip
								:text="t('dms_database.diagram.toolbar.note_hint')"
								:kbds="['n']"
							>
								<UButton
									size="sm"
									color="neutral"
									variant="ghost"
									icon="i-ph-note-pencil"
									:label="t('dms_database.diagram.toolbar.note')"
									:disabled="isEmpty"
									@click="addNote"
								/>
							</UTooltip>
						</div>
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
/* As wide as its content: a centred panel only gets half the canvas, which
   would wrap a bar that fits. It wraps only when the screen is narrower. */
.diagram-float {
	display: flex;
	flex-wrap: wrap;
	width: max-content;
	max-width: calc(100vw - 4rem);
	align-items: center;
	gap: 2px;
	padding: 4px;
	border: 1px solid var(--ui-border-accented);
	border-radius: var(--ui-radius);
	background: var(--ui-bg-elevated);
	box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
}
.diagram-float__sep {
	width: 1px;
	height: 18px;
	margin: 0 4px;
	background: var(--ui-border);
}
.diagram-legend {
	display: flex;
	gap: 12px;
	padding: 6px 10px;
	border: 1px solid var(--ui-border);
	border-radius: calc(var(--ui-radius) * 0.75);
	background: color-mix(in srgb, var(--ui-bg-elevated) 88%, transparent);
	font: 500 11px var(--font-mono, ui-monospace, monospace);
	color: var(--ui-text-muted);
}
.diagram-legend span {
	display: inline-flex;
	align-items: center;
	gap: 5px;
}
/* Below md the legend and the overview give their room to the canvas. */
@media (max-width: 767.98px) {
	.diagram-legend,
	:deep(.vue-flow__minimap) {
		display: none;
	}
}
</style>
