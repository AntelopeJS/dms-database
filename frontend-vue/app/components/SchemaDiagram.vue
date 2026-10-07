<script setup lang="ts">
import type {
	NodeDragEvent,
	NodeMouseEvent,
	VueFlowStore,
} from "@vue-flow/core";
import { onKeyStroke, useDebounceFn, useNow } from "@vueuse/core";
import type { ShallowUnwrapRef } from "vue";
import {
	autoLayoutPositions,
	buildGraph,
	type DiagramNode,
	NODE_WIDTH,
	NOTE_NODE_TYPE,
	type NoteDraft,
	neighbourIds,
	RELATION_EDGE_TYPE,
	type Sides,
	STUB_NODE_TYPE,
	TABLE_NODE_TYPE,
	tableNodeId,
} from "../build/diagram/graph";
import {
	clonePositions,
	DiagramHistory,
	type DiagramOperation,
	type DiagramState,
} from "../build/diagram/history";
import { DiagramSync, noteFromStored } from "../build/diagram/sync";
import DiagramNoteNode from "./DiagramNoteNode.vue";
import DiagramRelationEdge from "./DiagramRelationEdge.vue";
import DiagramStubNode from "./DiagramStubNode.vue";
import DiagramTableNode from "./DiagramTableNode.vue";
import TableInspector from "./TableInspector.vue";

// The Diagram page: the tables of one schema and their relations. Moving a
// table saves the layout on its own (D-10), with undo and redo; auto layout
// is previewed before it is kept, because it moves every table at once.

type SaveState = "idle" | "saving" | "saved" | "error";

const SAVE_DELAY_MS = 800;
const RESET_ZOOM = 1;
const NOTE_WIDTH = 220;
const NOTE_HEIGHT = 140;
const MINUTE_MS = 60_000;
// Room around the tables for the floating toolbars.
const FIT_PADDING = 0.25;
// Above this many tables the canvas suggests focusing on one of them.
const LARGE_SCHEMA_TABLES = 40;

const { t } = useI18n();
const route = useDmsRoute();
const router = useDmsRouter();
const { schemas, isLoading: schemasLoading } = useDatabaseSchemas();
const persistence = useDiagramPersistence();
const { open: openDrawer } = useDrawer();
const now = useNow({ interval: MINUTE_MS / 2 });

const canvas = shallowRef<ShallowUnwrapRef<VueFlowStore> | null>(null);
const canvasWrapper = useTemplateRef<HTMLElement>("canvasWrapper");
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement }>("searchInput");

const state = reactive<DiagramState>({ positions: {}, notes: [] });
const history = new DiagramHistory();
const historyRevision = ref(0);
const routing = new Map<string, Sides>();

const selectedId = ref<string | null>(null);
const focusId = ref<string | null>(null);
const panMode = ref(false);
const search = ref("");
const searchMissed = ref(false);
const viewport = ref({ x: 0, y: 0, zoom: RESET_ZOOM });
const preview = ref<{ from: DiagramState["positions"] } | null>(null);
const saveState = ref<SaveState>("idle");
const savedAt = ref<Date | null>(null);
const loaded = ref(false);
let sync: DiagramSync | null = null;
let saving: Promise<void> | null = null;
let fitPending = true;

// --- schema ---
const schemaId = computed<string | null>(() => {
	const asked = route.query.schema;
	if (typeof asked === "string" && schemas.value.some((s) => s.id === asked)) return asked;
	return schemas.value[0]?.id ?? null;
});
const schema = computed(() => schemas.value.find((s) => s.id === schemaId.value) ?? null);
const schemaItems = computed(() =>
	schemas.value.map((s) => ({ label: s.id, value: s.id, icon: "i-ph-stack" })),
);

function openSchema(id: string) {
	if (id === schemaId.value) return;
	router.replace({ query: { ...route.query, schema: id, table: undefined } });
}

// --- graph ---
const focusIds = computed(() =>
	focusId.value && schema.value
		? neighbourIds(schema.value, focusId.value.split("::")[1] ?? "")
		: null,
);

function render() {
	if (!canvas.value || !schema.value || !loaded.value) return;
	const built = buildGraph({
		schema: schema.value,
		positions: state.positions,
		notes: state.notes,
		selectedId: selectedId.value,
		focusIds: focusIds.value,
		noteHandlers: { onTextChange: changeNoteText, onDelete: deleteNote },
		onOpenSchema: openSchema,
		routing,
	});
	canvas.value.setNodes(built.nodes);
	canvas.value.setEdges(built.edges);
}

// The nodes have been measured: the first fit, or the one a schema change or
// a focus asks for, can frame them.
function onNodesInitialized() {
	if (!fitPending) return;
	fitPending = false;
	if (!centerOnQueryTable()) fitAll();
}

function fitAll() {
	canvas.value?.fitView({ padding: FIT_PADDING, maxZoom: RESET_ZOOM });
}

watch([canvas, schema, selectedId, focusIds, loaded], render);

// --- loading and saving ---
async function load(id: string) {
	loaded.value = false;
	routing.clear();
	history.clear();
	historyRevision.value++;
	preview.value = null;
	selectedId.value = null;
	focusId.value = null;
	const owner = new DiagramSync(persistence, id, renameNote);
	sync = owner;
	try {
		const [positions, notes] = await Promise.all([
			persistence.fetchLayout(id),
			persistence.fetchNotes(id),
		]);
		if (sync !== owner) return;
		state.positions = positions;
		state.notes = notes.map(noteFromStored);
	} catch {
		if (sync !== owner) return;
		state.positions = {};
		state.notes = [];
	}
	owner.reset(state);
	saveState.value = "idle";
	fitPending = true;
	loaded.value = true;
}

watch(schemaId, (id) => id && load(id), { immediate: true });

async function saveNow() {
	const owner = sync;
	if (!owner || preview.value) return;
	if (saving) await saving;
	if (!owner.hasChanges(state)) return;
	saveState.value = "saving";
	saving = owner
		.save(state)
		.then(() => {
			saveState.value = "saved";
			savedAt.value = new Date();
		})
		.catch(() => {
			saveState.value = "error";
		})
		.finally(() => {
			saving = null;
		});
	await saving;
}

const scheduleSave = useDebounceFn(saveNow, SAVE_DELAY_MS);

function record(op: DiagramOperation) {
	history.push(op);
	historyRevision.value++;
	scheduleSave();
}

function renameNote(fromId: string, toId: string) {
	history.renameNote(fromId, toId);
	render();
}

onBeforeUnmount(() => {
	saveNow();
});

const savedLabel = computed(() => {
	if (saveState.value === "saving") return t("dms_database.diagram.save.saving");
	if (saveState.value === "error") return t("dms_database.diagram.save.error");
	if (!savedAt.value) return t("dms_database.diagram.save.idle");
	const minutes = Math.round((now.value.getTime() - savedAt.value.getTime()) / MINUTE_MS);
	return minutes < 1
		? t("dms_database.diagram.save.just_now")
		: t("dms_database.diagram.save.minutes", { count: minutes });
});

// --- undo / redo ---
const canUndo = computed(() => historyRevision.value >= 0 && history.canUndo && !preview.value);
const canRedo = computed(() => historyRevision.value >= 0 && history.canRedo && !preview.value);

function undo() {
	if (!canUndo.value || !history.undo(state)) return;
	historyRevision.value++;
	render();
	scheduleSave();
}

function redo() {
	if (!canRedo.value || !history.redo(state)) return;
	historyRevision.value++;
	render();
	scheduleSave();
}

// --- auto layout, previewed before it is kept ---
const movedCount = computed(() => {
	if (!preview.value || !schema.value) return 0;
	return schema.value.tables.filter((table) => {
		// A table without a saved position already sat where dagre puts it.
		const before = preview.value?.from[table.name];
		const after = state.positions[table.name];
		return Boolean(before && after && (before.x !== after.x || before.y !== after.y));
	}).length;
});

function startAutoLayout() {
	if (!schema.value || preview.value) return;
	preview.value = { from: clonePositions(state.positions) };
	state.positions = autoLayoutPositions(schema.value);
	routing.clear();
	render();
	nextTick(fitAll);
}

function keepLayout() {
	if (!preview.value) return;
	const from = preview.value.from;
	preview.value = null;
	record({ kind: "layout", from, to: clonePositions(state.positions) });
}

function discardLayout() {
	if (!preview.value) return;
	state.positions = preview.value.from;
	preview.value = null;
	render();
}

// --- dragging ---
const dragStarts = new Map<string, { x: number; y: number }>();

function onNodeDragStart({ node }: NodeDragEvent) {
	dragStarts.set(node.id, { x: node.position.x, y: node.position.y });
}

function tableMoved(node: DiagramNode, from: { x: number; y: number }) {
	const tableName = (node.data as { tableName: string }).tableName;
	const to = { x: node.position.x, y: node.position.y };
	state.positions[tableName] = to;
	if (preview.value) return;
	record({ kind: "tableMove", tableName, from, to });
}

function noteMoved(node: DiagramNode, from: { x: number; y: number }) {
	const noteId = (node.data as { noteId: string }).noteId;
	const to = { x: node.position.x, y: node.position.y };
	const note = state.notes.find((n) => n.id === noteId);
	if (!note) return;
	Object.assign(note, to);
	record({ kind: "noteMove", noteId, from, to });
}

const DRAG_HANDLERS: Record<string, (node: DiagramNode, from: { x: number; y: number }) => void> = {
	[TABLE_NODE_TYPE]: tableMoved,
	[NOTE_NODE_TYPE]: noteMoved,
};

function onNodeDragStop({ node }: NodeDragEvent) {
	const from = dragStarts.get(node.id);
	dragStarts.delete(node.id);
	if (!from || (from.x === node.position.x && from.y === node.position.y)) return;
	DRAG_HANDLERS[node.type ?? ""]?.(node as unknown as DiagramNode, from);
	render();
}

// --- selection and inspection ---
function onNodeClick({ node }: NodeMouseEvent) {
	selectedId.value = node.type === TABLE_NODE_TYPE ? node.id : null;
}

function onPaneClick() {
	selectedId.value = null;
}

function inspect(tableName: string) {
	if (!schemaId.value) return;
	openDrawer({
		title: t("dms_database.schemas.inspector.title"),
		direction: "right",
		component: TableInspector,
		componentOptions: { rowData: { schema: schemaId.value, name: tableName } },
	});
}

function onNodeDoubleClick({ node }: NodeMouseEvent) {
	if (node.type !== TABLE_NODE_TYPE) return;
	inspect((node.data as { tableName: string }).tableName);
}

function centerOn(nodeId: string): boolean {
	const node = canvas.value?.findNode(nodeId);
	if (!node) return false;
	selectedId.value = nodeId;
	canvas.value?.setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + 120, {
		zoom: Math.max(viewport.value.zoom, RESET_ZOOM),
		duration: 300,
	});
	return true;
}

function centerOnQueryTable(): boolean {
	const table = route.query.table;
	if (typeof table !== "string" || !schemaId.value) return false;
	return centerOn(tableNodeId(schemaId.value, table));
}

const selectedTable = computed(() => selectedId.value?.split("::")[1] ?? null);

function toggleFocus() {
	focusId.value = focusId.value ? null : selectedId.value;
	render();
	nextTick(fitAll);
}

// --- search: a table or a column ---
function findTable(needle: string): string | null {
	const text = needle.trim().toLowerCase();
	if (!text || !schema.value) return null;
	const byName = schema.value.tables.find((table) => table.name.toLowerCase().includes(text));
	const byColumn = schema.value.tables.find((table) =>
		Object.keys(table.fields).some((field) => field.toLowerCase().includes(text)),
	);
	const match = byName ?? byColumn;
	return match ? tableNodeId(schema.value.id, match.name) : null;
}

function runSearch() {
	const id = findTable(search.value);
	searchMissed.value = id === null && search.value.trim() !== "";
	if (id) {
		focusId.value = null;
		centerOn(id);
	}
}

watch(search, () => {
	searchMissed.value = false;
});

// --- notes ---
function addNote() {
	if (!schemaId.value) return;
	const rect = canvasWrapper.value?.getBoundingClientRect();
	const { x, y, zoom } = viewport.value;
	const note: NoteDraft = {
		id: `temp-${Date.now()}`,
		schemaName: schemaId.value,
		text: "",
		x: ((rect?.width ?? 800) / 2 - x) / zoom - NOTE_WIDTH / 2,
		y: ((rect?.height ?? 600) / 2 - y) / zoom - NOTE_HEIGHT / 2,
		width: NOTE_WIDTH,
		height: NOTE_HEIGHT,
		color: null,
		isTemp: true,
	};
	state.notes.push(note);
	record({ kind: "noteCreate", snapshot: { ...note } });
	render();
}

function changeNoteText(noteId: string, text: string) {
	const note = state.notes.find((n) => n.id === noteId);
	if (!note || note.text === text) return;
	record({ kind: "noteText", noteId, from: note.text, to: text });
	note.text = text;
	render();
}

function deleteNote(noteId: string) {
	const note = state.notes.find((n) => n.id === noteId);
	if (!note) return;
	state.notes = state.notes.filter((n) => n.id !== noteId);
	record({ kind: "noteDelete", snapshot: { ...note } });
	render();
}

// --- viewport ---
const zoomPercent = computed(() => `${Math.round(viewport.value.zoom * 100)}%`);

function onViewportChange(next: { x: number; y: number; zoom: number }) {
	viewport.value = { ...next };
}

// --- keyboard: the shortcuts the toolbar's tooltips name ---
function typing(event: KeyboardEvent): boolean {
	const target = event.target as HTMLElement | null;
	return Boolean(target?.closest("input, textarea, [contenteditable=true]"));
}

function shortcut(handler: () => void) {
	return (event: KeyboardEvent) => {
		if (typing(event) || event.metaKey || event.ctrlKey || event.altKey) return;
		event.preventDefault();
		handler();
	};
}

onKeyStroke("f", shortcut(() => searchInput.value?.inputRef?.focus()));
onKeyStroke("n", shortcut(addNote));
onKeyStroke("v", shortcut(() => (panMode.value = false)));
onKeyStroke("h", shortcut(() => (panMode.value = true)));
onKeyStroke("1", shortcut(fitAll));
onKeyStroke("0", shortcut(() => canvas.value?.zoomTo(RESET_ZOOM)));
onKeyStroke("z", (event) => {
	if (typing(event) || !(event.metaKey || event.ctrlKey)) return;
	event.preventDefault();
	if (event.shiftKey) redo();
	else undo();
});

// Imported, not resolved by name: the edge must mount in the SVG namespace,
// which an async global component does not.
const nodeTypes = markRaw({
	[TABLE_NODE_TYPE]: DiagramTableNode,
	[STUB_NODE_TYPE]: DiagramStubNode,
	[NOTE_NODE_TYPE]: DiagramNoteNode,
});
const edgeTypes = markRaw({ [RELATION_EDGE_TYPE]: DiagramRelationEdge });

const isEmpty = computed(() => loaded.value && (schema.value?.tables.length ?? 0) === 0);
const isLarge = computed(
	() => !focusId.value && (schema.value?.tables.length ?? 0) > LARGE_SCHEMA_TABLES,
);
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
			<DmsFlowCanvas
				ref="canvas"
				:node-types="nodeTypes"
				:edge-types="edgeTypes"
				:controls="false"
				:fit-view-on-init="false"
				minimap
				:pan-on-drag="panMode"
				:nodes-draggable="!panMode"
				@nodes-initialized="onNodesInitialized"
				@viewport-change="onViewportChange"
				@node-drag-start="onNodeDragStart"
				@node-drag-stop="onNodeDragStop"
				@node-click="onNodeClick"
				@node-double-click="onNodeDoubleClick"
				@pane-click="onPaneClick"
			>
				<template #top-left>
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
							class="w-56"
							:color="searchMissed ? 'error' : 'primary'"
							:highlight="searchMissed"
							:placeholder="t('dms_database.diagram.search')"
							@keydown.enter.prevent="runSearch"
						>
							<template #trailing><UKbd value="F" size="sm" /></template>
						</UInput>
					</div>
				</template>

				<template #top-right>
					<div class="diagram-float">
						<span
							class="flex items-center gap-1.5 px-2 font-mono text-[11.5px]"
							:class="saveState === 'error' ? 'text-error' : 'text-dimmed'"
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
							{{ savedLabel }}
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
						<UTooltip :text="t('dms_database.diagram.toolbar.undo')">
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
						<UTooltip :text="t('dms_database.diagram.toolbar.redo')">
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
						<UTooltip :text="t('dms_database.diagram.toolbar.auto_layout_hint')">
							<UButton
								size="sm"
								color="neutral"
								variant="ghost"
								icon="i-ph-squares-four"
								:label="t('dms_database.diagram.toolbar.auto_layout')"
								:disabled="Boolean(preview) || isEmpty"
								@click="startAutoLayout"
							/>
						</UTooltip>
					</div>
				</template>

				<template #top-center>
					<div
						v-if="preview"
						class="diagram-float border-primary/40 mt-12 gap-2 py-1.5 pr-1.5 pl-3 text-sm"
					>
						<UIcon name="i-ph-squares-four" class="text-primary size-4" />
						<span>{{ t("dms_database.diagram.preview.title") }}</span>
						<span class="text-muted mr-1">{{ t("dms_database.diagram.preview.moved", movedCount) }}</span>
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
						class="diagram-float mt-12 gap-1 py-1 pr-1 pl-3 text-sm"
					>
						<UIcon name="i-ph-table" class="text-primary size-4" />
						<span class="font-mono text-[12.5px]">{{ selectedTable ?? focusId?.split("::")[1] }}</span>
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
					<div v-else-if="isLarge" class="diagram-float text-warning mt-12 gap-2 px-3 py-2 text-sm">
						<UIcon name="i-ph-warning" class="size-4" />
						{{ t("dms_database.diagram.large", { count: schema?.tables.length ?? 0 }) }}
					</div>
				</template>

				<template #bottom-left>
					<div class="diagram-legend">
						<span><UIcon name="i-ph-key" class="text-warning" />{{ t("dms_database.diagram.legend.key") }}</span>
						<span><UIcon name="i-ph-arrow-right" class="text-primary" />{{ t("dms_database.diagram.legend.relation") }}</span>
						<span><UIcon name="i-ph-brackets-curly" />{{ t("dms_database.diagram.legend.object") }}</span>
						<span><UIcon name="i-ph-lock-key" />{{ t("dms_database.modifiers.encrypted") }}</span>
					</div>
				</template>

				<template #bottom-center>
					<div class="diagram-float">
						<UTooltip :text="t('dms_database.diagram.toolbar.select')">
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
						<UTooltip :text="t('dms_database.diagram.toolbar.pan')">
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
						<UTooltip :text="t('dms_database.diagram.toolbar.reset_zoom')">
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
						<UTooltip :text="t('dms_database.diagram.toolbar.fit')">
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
						<UTooltip :text="t('dms_database.diagram.toolbar.note_hint')">
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
.diagram-float {
	display: flex;
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
</style>
