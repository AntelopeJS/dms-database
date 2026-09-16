<script setup lang="ts">
import {
	MarkerType,
	type NodeDragEvent,
	type NodeMouseEvent,
	type VueFlowStore,
} from "@vue-flow/core";
import dagre from "@dagrejs/dagre";
import type { SchemaSummary } from "../composables/useDatabaseSchemas";
import type {
	DiagramNote,
	DiagramPositions,
} from "../composables/useDiagramPersistence";

// Schema diagram canvas — rendered inline as the "Diagram" view of the schema
// page (not a dedicated page). The active schema is driven by the `schemaId`
// prop (the page pill); `active` lets the parent trigger a refit when the view
// becomes visible (vue-flow needs a measured container).
interface Props {
	schemaId: string | null;
	active?: boolean;
}

const props = withDefaults(defineProps<Props>(), { active: true });

const emit = defineEmits<{
	// A table node was double-clicked — the parent opens the shared inspector
	// drawer for that table (same drawer as the schema list view).
	"inspect-table": [tableName: string];
}>();

const NODE_WIDTH = 240;
const NODE_HEIGHT_PER_FIELD = 28;
const NODE_HEIGHT_HEADER = 40;
const STUB_NODE_WIDTH = 180;
const STUB_NODE_HEIGHT = 28;
const LAYOUT_DIRECTION = "TB";
const LAYOUT_NODE_SEP = 40;
const LAYOUT_RANK_SEP = 80;
const TABLE_NODE_TYPE = "tableNode";
const STUB_NODE_TYPE = "stubNode";
const NOTE_NODE_TYPE = "noteNode";
const RELATION_EDGE_TYPE = "relationEdge";
const RESET_ZOOM = 1;
const NOTE_DEFAULT_WIDTH = 220;
const NOTE_DEFAULT_HEIGHT = 140;
const SQUASH_WINDOW_MS = 600;
const HYSTERESIS_PX = 15;

type HandleSide = "left" | "right";
interface Sides {
	source: HandleSide;
	target: HandleSide;
}

function pickSides(dx: number, W: number, prev?: Sides): Sides {
	const pure: Sides =
		dx >= W
			? { source: "right", target: "left" }
			: dx >= 0
				? { source: "right", target: "right" }
				: dx >= -W
					? { source: "left", target: "left" }
					: { source: "left", target: "right" };
	if (!prev || (prev.source === pure.source && prev.target === pure.target)) {
		return pure;
	}
	const H = HYSTERESIS_PX;
	if (prev.source === "right" && prev.target === "left" && dx > W - H)
		return prev;
	if (
		prev.source === "right" &&
		prev.target === "right" &&
		dx > -H &&
		dx < W + H
	)
		return prev;
	if (
		prev.source === "left" &&
		prev.target === "left" &&
		dx > -W - H &&
		dx < H
	)
		return prev;
	if (prev.source === "left" && prev.target === "right" && dx < -W + H)
		return prev;
	return pure;
}

const edgeRouting = new Map<string, Sides>();

interface NoteDraft {
	id: string;
	schemaName: string;
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color: string | null;
	isTemp: boolean;
}

type Op =
	| {
			kind: "tableMove";
			tableName: string;
			from: { x: number; y: number };
			to: { x: number; y: number };
	  }
	| {
			kind: "noteMove";
			noteId: string;
			from: { x: number; y: number };
			to: { x: number; y: number };
	  }
	| { kind: "noteText"; noteId: string; from: string; to: string }
	| { kind: "noteCreate"; tempId: string; snapshot: NoteDraft }
	| { kind: "noteDelete"; snapshot: NoteDraft }
	| { kind: "autoLayout"; from: DiagramPositions };

interface TableDiagramNode {
	id: string;
	type: typeof TABLE_NODE_TYPE;
	position: { x: number; y: number };
	data: {
		tableName: string;
		fields: Record<string, unknown>;
		indexes: Record<string, { fields?: string[] }>;
		modifiers: Record<string, string[]>;
	};
}

interface StubDiagramNode {
	id: string;
	type: typeof STUB_NODE_TYPE;
	position: { x: number; y: number };
	selectable: false;
	draggable: false;
	data: {
		targetSchema: string;
		targetTable: string;
	};
}

interface NoteDiagramNode {
	id: string;
	type: typeof NOTE_NODE_TYPE;
	position: { x: number; y: number };
	data: {
		noteId: string;
		text: string;
		color: string | null;
		width: number;
		height: number;
		onTextChange: (noteId: string, text: string) => void;
		onDelete: (noteId: string) => void;
	};
}

type DiagramNodeT = TableDiagramNode | StubDiagramNode | NoteDiagramNode;

interface DiagramEdge {
	id: string;
	type: typeof RELATION_EDGE_TYPE;
	source: string;
	target: string;
	sourceHandle: string;
	targetHandle: string;
	label: string;
	animated: boolean;
	markerEnd: { type: MarkerType };
	data: {
		sourceBase: string;
		targetBase: string;
		isStubTarget: boolean;
	};
}

const { t } = useI18n();
const { schemas } = useDatabaseSchemas();
const {
	fetchLayout,
	saveLayout,
	fetchNotes,
	createNote,
	updateNote,
	deleteNote,
} = useDiagramPersistence();
// DmsFlowCanvas (shared dms-ui layer) owns the <VueFlow> instance and the
// canvas chrome (dotted DMS background, themed handles/edges, pan/zoom). It
// exposes the full imperative VueFlow controller (setNodes/setEdges/fitView/
// viewport/findNode/onNodeDrag…) via a template ref; all the ERD business
// logic below (dagre auto-layout, edge routing, undo/redo, notes) stays here.
const canvas = ref<VueFlowStore | null>(null);
// Our own wrapper element — used to measure the visible canvas for note placement.
const canvasWrapper = ref<HTMLElement | null>(null);

function fitView() {
	canvas.value?.fitView();
}
function zoomIn() {
	canvas.value?.zoomIn();
}
function zoomOut() {
	canvas.value?.zoomOut();
}

const panMode = ref(false);
const rebuildKey = ref(0);

// Live viewport mirror. VueFlow's controller `viewport` ref read through the
// exposed DmsFlowCanvas template ref doesn't stay reactive here, so the zoom
// readout froze at 100% and notes were placed against a stale {0,0,1} origin.
// We keep our own copy fed by VueFlow's @viewport-change event (forwarded by
// DmsFlowCanvas via $attrs) — it fires on wheel/pinch zoom, pan and the +/-/fit
// controls — and derive both the zoom badge and note placement from it.
const liveViewport = ref({ x: 0, y: 0, zoom: RESET_ZOOM });

function onViewportChange(viewport: { x: number; y: number; zoom: number }) {
	liveViewport.value = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
}

const tablePositions = ref<DiagramPositions>({});
const notes = ref<NoteDraft[]>([]);
const baseline = ref<{ tablePositions: DiagramPositions; notes: NoteDraft[] }>({
	tablePositions: {},
	notes: [],
});

const history = ref<Op[]>([]);
const cursor = ref(0);
let lastOpAt = 0;

const applying = ref(false);
let tempCounter = 0;
let initialFitDone = false;
// Gate the very first paint until both the canvas controller is mounted and the
// initial schema layout has loaded (the controller is async now, unlike the old
// synchronous useVueFlow), so saved table positions land on the first render.
let initialLayoutSettled = false;
let initialRenderDone = false;
let loadToken = 0;

const isDirty = computed(() => cursor.value > 0);
const canUndo = computed(() => cursor.value > 0);
const canRedo = computed(() => cursor.value < history.value.length);

const effectiveSchemaId = computed<string | null>(
	() => props.schemaId ?? schemas.value[0]?.id ?? null,
);

const visibleSchemas = computed<SchemaSummary[]>(() => {
	const id = effectiveSchemaId.value;
	if (!id) return [];
	const match = schemas.value.find((s) => s.id === id);
	return match ? [match] : [];
});

function nodeIdFor(schemaId: string, tableName: string): string {
	return `${schemaId}::${tableName}`;
}

function stubIdFor(schemaId: string, tableName: string): string {
	return `stub::${schemaId}::${tableName}`;
}

function noteNodeIdFor(noteId: string): string {
	return `note::${noteId}`;
}

function clonePositions(p: DiagramPositions): DiagramPositions {
	const out: DiagramPositions = {};
	for (const [k, v] of Object.entries(p)) out[k] = { x: v.x, y: v.y };
	return out;
}

function cloneNote(n: NoteDraft): NoteDraft {
	return { ...n };
}

interface BuiltGraph {
	nodes: DiagramNodeT[];
	edges: DiagramEdge[];
}

function buildGraph(schemaList: SchemaSummary[]): BuiltGraph {
	const visibleIds = new Set<string>();
	for (const schema of schemaList) {
		for (const table of schema.tables) {
			visibleIds.add(nodeIdFor(schema.id, table.name));
		}
	}

	const graph = new dagre.graphlib.Graph();
	graph.setDefaultEdgeLabel(() => ({}));
	graph.setGraph({
		rankdir: LAYOUT_DIRECTION,
		nodesep: LAYOUT_NODE_SEP,
		ranksep: LAYOUT_RANK_SEP,
	});

	for (const schema of schemaList) {
		for (const table of schema.tables) {
			const fieldCount = Object.keys(table.fields).length;
			const height = NODE_HEIGHT_HEADER + fieldCount * NODE_HEIGHT_PER_FIELD;
			graph.setNode(nodeIdFor(schema.id, table.name), {
				width: NODE_WIDTH,
				height,
			});
		}
	}

	const stubs = new Map<string, { schema: string; table: string }>();
	const tableFieldsById = new Map<string, Record<string, unknown>>();
	for (const schema of schemaList) {
		for (const table of schema.tables) {
			tableFieldsById.set(nodeIdFor(schema.id, table.name), table.fields);
		}
	}

	interface PendingEdge {
		id: string;
		sourceId: string;
		targetId: string;
		sourceBase: string;
		targetBase: string;
		isStubTarget: boolean;
		label: string;
		many: boolean;
	}
	const pendingEdges: PendingEdge[] = [];

	for (const schema of schemaList) {
		for (const table of schema.tables) {
			const sourceId = nodeIdFor(schema.id, table.name);
			const sourceFields = tableFieldsById.get(sourceId);
			for (const rel of table.relations ?? []) {
				const realTargetId = nodeIdFor(rel.toSchema, rel.toTable);
				const isStubTarget = !visibleIds.has(realTargetId);
				const targetId = isStubTarget
					? stubIdFor(rel.toSchema, rel.toTable)
					: realTargetId;
				if (isStubTarget && !stubs.has(targetId)) {
					stubs.set(targetId, {
						schema: rel.toSchema,
						table: rel.toTable,
					});
					graph.setNode(targetId, {
						width: STUB_NODE_WIDTH,
						height: STUB_NODE_HEIGHT,
					});
				}
				graph.setEdge(sourceId, targetId);
				const sourceBase =
					sourceFields && rel.fromField in sourceFields
						? rel.fromField
						: "__node__";
				let targetBase: string;
				if (isStubTarget) {
					targetBase = "stub";
				} else {
					const targetFields = tableFieldsById.get(realTargetId);
					targetBase =
						targetFields && rel.toField in targetFields
							? rel.toField
							: "__node__";
				}
				pendingEdges.push({
					id: `${sourceId}::${rel.fromField}->${realTargetId}`,
					sourceId,
					targetId,
					sourceBase,
					targetBase,
					isStubTarget,
					label: rel.fromField,
					many: rel.many,
				});
			}
		}
	}

	dagre.layout(graph);

	const nodePositions = new Map<
		string,
		{ x: number; y: number; width: number }
	>();
	const nodes: DiagramNodeT[] = [];
	for (const schema of schemaList) {
		for (const table of schema.tables) {
			const id = nodeIdFor(schema.id, table.name);
			const laid = graph.node(id);
			const saved = tablePositions.value[table.name];
			const position = saved ?? { x: laid.x - NODE_WIDTH / 2, y: laid.y };
			nodePositions.set(id, { x: position.x, y: position.y, width: NODE_WIDTH });
			nodes.push({
				id,
				type: TABLE_NODE_TYPE,
				position,
				data: {
					tableName: table.name,
					fields: table.fields,
					indexes: table.indexes,
					modifiers: table.modifiers,
				},
			});
		}
	}
	for (const [id, info] of stubs) {
		const laid = graph.node(id);
		const position = { x: laid.x - STUB_NODE_WIDTH / 2, y: laid.y };
		nodePositions.set(id, {
			x: position.x,
			y: position.y,
			width: STUB_NODE_WIDTH,
		});
		nodes.push({
			id,
			type: STUB_NODE_TYPE,
			position,
			selectable: false,
			draggable: false,
			data: { targetSchema: info.schema, targetTable: info.table },
		});
	}

	const edges: DiagramEdge[] = [];
	for (const pe of pendingEdges) {
		const sPos = nodePositions.get(pe.sourceId);
		const tPos = nodePositions.get(pe.targetId);
		if (!sPos || !tPos) continue;
		const dx = tPos.x + tPos.width / 2 - (sPos.x + sPos.width / 2);
		const sides = pickSides(dx, NODE_WIDTH, edgeRouting.get(pe.id));
		edgeRouting.set(pe.id, sides);
		const sourceHandle = `${pe.sourceBase}::${sides.source}::source`;
		const targetHandle = `${pe.targetBase}::${sides.target}::target`;
		edges.push({
			id: pe.id,
			type: RELATION_EDGE_TYPE,
			source: pe.sourceId,
			target: pe.targetId,
			sourceHandle,
			targetHandle,
			label: pe.label,
			animated: pe.many,
			markerEnd: { type: MarkerType.ArrowClosed },
			data: {
				sourceBase: pe.sourceBase,
				targetBase: pe.targetBase,
				isStubTarget: pe.isStubTarget,
			},
		});
	}

	for (const note of notes.value) {
		nodes.push({
			id: noteNodeIdFor(note.id),
			type: NOTE_NODE_TYPE,
			position: { x: note.x, y: note.y },
			data: {
				noteId: note.id,
				text: note.text,
				color: note.color,
				width: note.width,
				height: note.height,
				onTextChange: onNoteTextChange,
				onDelete: onNoteDelete,
			},
		});
	}

	return { nodes, edges };
}

function rebuildAndApply() {
	if (!canvas.value) return;
	const built = buildGraph(visibleSchemas.value);
	canvas.value.setNodes(built.nodes);
	canvas.value.setEdges(built.edges);
}

// Data-driven rebuilds after the first paint: schema edits, drag-induced
// rebuildKey bumps, undo/redo, notes. The initial render is owned by
// renderInitialGraph so it isn't a premature dagre-only pass before the saved
// positions have loaded.
watch(
	[visibleSchemas, rebuildKey],
	() => {
		if (initialRenderDone) rebuildAndApply();
	},
	{ deep: true },
);

// First paint: defer until BOTH the canvas controller is mounted AND the initial
// schema layout has settled (whichever happens last drives it), so the very
// first render already carries saved table positions instead of flashing the
// dagre fallback. Triggered from watch(canvas) and from loadSchema.
function renderInitialGraph() {
	if (initialRenderDone || !canvas.value || !initialLayoutSettled) return;
	initialRenderDone = true;
	rebuildAndApply();
}
watch(canvas, renderInitialGraph);

function onNodesInitialized() {
	if (initialFitDone) return;
	initialFitDone = true;
	fitView();
}

// Re-fit when the diagram view becomes visible again (vue-flow can't measure a
// hidden container, so a toggle from List -> Diagram needs a nudge).
watch(
	() => props.active,
	(active) => {
		if (active) nextTick(() => fitView());
	},
);

async function loadSchema(id: string) {
	const myToken = ++loadToken;
	edgeRouting.clear();
	try {
		const [pos, items] = await Promise.all([fetchLayout(id), fetchNotes(id)]);
		if (myToken !== loadToken) return;
		const loadedNotes: NoteDraft[] = items.map((n: DiagramNote) => ({
			id: n.id,
			schemaName: n.schemaName,
			text: n.text,
			x: n.x,
			y: n.y,
			width: n.width,
			height: n.height,
			color: n.color,
			isTemp: false,
		}));
		tablePositions.value = clonePositions(pos);
		notes.value = loadedNotes.map(cloneNote);
		baseline.value = {
			tablePositions: clonePositions(pos),
			notes: loadedNotes.map(cloneNote),
		};
		history.value = [];
		cursor.value = 0;
		rebuildKey.value++;
		initialLayoutSettled = true;
		renderInitialGraph();
		nextTick(() => fitView());
	} catch {
		if (myToken !== loadToken) return;
		tablePositions.value = {};
		notes.value = [];
		baseline.value = { tablePositions: {}, notes: [] };
		history.value = [];
		cursor.value = 0;
		rebuildKey.value++;
		initialLayoutSettled = true;
		renderInitialGraph();
	}
}

watch(
	effectiveSchemaId,
	(newId, oldId) => {
		if (newId === oldId) return;
		if (!newId) {
			tablePositions.value = {};
			notes.value = [];
			baseline.value = { tablePositions: {}, notes: [] };
			history.value = [];
			cursor.value = 0;
			rebuildKey.value++;
			initialLayoutSettled = true;
			renderInitialGraph();
			return;
		}
		loadSchema(newId);
	},
	{ immediate: true },
);

function pushOp(op: Op) {
	if (cursor.value < history.value.length) {
		history.value.splice(cursor.value);
	}
	const now = Date.now();
	const head = history.value[cursor.value - 1];
	const inWindow = now - lastOpAt < SQUASH_WINDOW_MS;
	let squashed = false;
	if (head && inWindow) {
		if (
			op.kind === "tableMove" &&
			head.kind === "tableMove" &&
			head.tableName === op.tableName
		) {
			head.to = op.to;
			squashed = true;
		} else if (
			op.kind === "noteMove" &&
			head.kind === "noteMove" &&
			head.noteId === op.noteId
		) {
			head.to = op.to;
			squashed = true;
		} else if (
			op.kind === "noteText" &&
			head.kind === "noteText" &&
			head.noteId === op.noteId
		) {
			head.to = op.to;
			squashed = true;
		}
	}
	if (!squashed) {
		history.value.push(op);
		cursor.value++;
	}
	lastOpAt = now;
}

function applyForward(op: Op) {
	switch (op.kind) {
		case "tableMove":
			tablePositions.value[op.tableName] = { ...op.to };
			break;
		case "noteMove": {
			const n = notes.value.find((x) => x.id === op.noteId);
			if (n) {
				n.x = op.to.x;
				n.y = op.to.y;
			}
			break;
		}
		case "noteText": {
			const n = notes.value.find((x) => x.id === op.noteId);
			if (n) n.text = op.to;
			break;
		}
		case "noteCreate":
			if (!notes.value.find((n) => n.id === op.tempId)) {
				notes.value.push(cloneNote(op.snapshot));
			}
			break;
		case "noteDelete": {
			const idx = notes.value.findIndex((n) => n.id === op.snapshot.id);
			if (idx >= 0) notes.value.splice(idx, 1);
			break;
		}
		case "autoLayout":
			tablePositions.value = {};
			break;
	}
}

function applyReverse(op: Op) {
	switch (op.kind) {
		case "tableMove":
			tablePositions.value[op.tableName] = { ...op.from };
			break;
		case "noteMove": {
			const n = notes.value.find((x) => x.id === op.noteId);
			if (n) {
				n.x = op.from.x;
				n.y = op.from.y;
			}
			break;
		}
		case "noteText": {
			const n = notes.value.find((x) => x.id === op.noteId);
			if (n) n.text = op.from;
			break;
		}
		case "noteCreate": {
			const idx = notes.value.findIndex((n) => n.id === op.tempId);
			if (idx >= 0) notes.value.splice(idx, 1);
			break;
		}
		case "noteDelete":
			notes.value.push(cloneNote(op.snapshot));
			break;
		case "autoLayout":
			tablePositions.value = clonePositions(op.from);
			break;
	}
}

function undo() {
	if (cursor.value === 0) return;
	cursor.value--;
	const op = history.value[cursor.value];
	if (!op) return;
	applyReverse(op);
	rebuildKey.value++;
}

function redo() {
	if (cursor.value >= history.value.length) return;
	const op = history.value[cursor.value];
	if (!op) return;
	applyForward(op);
	cursor.value++;
	rebuildKey.value++;
}

function cancelChanges() {
	tablePositions.value = clonePositions(baseline.value.tablePositions);
	notes.value = baseline.value.notes.map(cloneNote);
	history.value = [];
	cursor.value = 0;
	rebuildKey.value++;
}

async function applyChanges() {
	const id = effectiveSchemaId.value;
	if (!id || applying.value || !isDirty.value) return;
	applying.value = true;
	try {
		await saveLayout(id, clonePositions(tablePositions.value));

		const baselineNotes = baseline.value.notes;
		const baselineById = new Map(baselineNotes.map((n) => [n.id, n]));
		const currentReal = notes.value.filter((n) => !n.isTemp);
		const currentTemp = notes.value.filter((n) => n.isTemp);
		const currentIds = new Set(currentReal.map((n) => n.id));

		for (const b of baselineNotes) {
			if (!currentIds.has(b.id)) await deleteNote(b.id);
		}
		for (const c of currentReal) {
			const b = baselineById.get(c.id);
			if (!b) continue;
			if (
				b.x !== c.x ||
				b.y !== c.y ||
				b.text !== c.text ||
				b.width !== c.width ||
				b.height !== c.height ||
				b.color !== c.color
			) {
				await updateNote(c.id, {
					x: c.x,
					y: c.y,
					text: c.text,
					width: c.width,
					height: c.height,
					color: c.color ?? undefined,
				});
			}
		}
		for (const tempNote of currentTemp) {
			const created = await createNote({
				schemaName: id,
				text: tempNote.text,
				x: tempNote.x,
				y: tempNote.y,
				width: tempNote.width,
				height: tempNote.height,
				color: tempNote.color ?? undefined,
			});
			const idx = notes.value.findIndex((n) => n.id === tempNote.id);
			if (idx >= 0) {
				notes.value[idx] = {
					id: created.id,
					schemaName: created.schemaName,
					text: created.text,
					x: created.x,
					y: created.y,
					width: created.width,
					height: created.height,
					color: created.color,
					isTemp: false,
				};
			}
		}

		baseline.value = {
			tablePositions: clonePositions(tablePositions.value),
			notes: notes.value.map(cloneNote),
		};
		history.value = [];
		cursor.value = 0;
		rebuildKey.value++;
	} catch (err) {
		console.error("Failed to apply diagram changes", err);
	} finally {
		applying.value = false;
	}
}

const nodeTypes = {
	[TABLE_NODE_TYPE]: resolveComponent("DmsDatabaseDiagramTableNode"),
	[STUB_NODE_TYPE]: resolveComponent("DmsDatabaseDiagramStubNode"),
	[NOTE_NODE_TYPE]: resolveComponent("DmsDatabaseDiagramNoteNode"),
};

const edgeTypes = {
	[RELATION_EDGE_TYPE]: resolveComponent("DmsDatabaseDiagramRelationEdge"),
};

const zoomPercent = computed(
	() => `${Math.round(liveViewport.value.zoom * 100)}%`,
);

function widthForNodeType(type: string | undefined): number {
	if (type === STUB_NODE_TYPE) return STUB_NODE_WIDTH;
	return NODE_WIDTH;
}

function recomputeEdgesForNode(nodeId: string) {
	const instance = canvas.value;
	if (!instance) return;
	for (const edge of instance.edges.value) {
		if (edge.source !== nodeId && edge.target !== nodeId) continue;
		const sNode = instance.findNode(edge.source);
		const tNode = instance.findNode(edge.target);
		if (!sNode || !tNode) continue;
		const sW = widthForNodeType(sNode.type);
		const tW = widthForNodeType(tNode.type);
		const dx = tNode.position.x + tW / 2 - (sNode.position.x + sW / 2);
		const prev = edgeRouting.get(edge.id);
		const next = pickSides(dx, NODE_WIDTH, prev);
		if (prev && prev.source === next.source && prev.target === next.target)
			continue;
		edgeRouting.set(edge.id, next);
		const data = edge.data as
			| { sourceBase: string; targetBase: string; isStubTarget: boolean }
			| undefined;
		if (!data) continue;
		edge.sourceHandle = `${data.sourceBase}::${next.source}::source`;
		edge.targetHandle = `${data.targetBase}::${next.target}::target`;
	}
}

const dragStartPositions = new Map<string, { x: number; y: number }>();

function onNodeDragStart({ node }: NodeDragEvent) {
	if (node.type !== TABLE_NODE_TYPE && node.type !== NOTE_NODE_TYPE) return;
	dragStartPositions.set(node.id, {
		x: node.position.x,
		y: node.position.y,
	});
}

function onNodeDrag({ node }: NodeDragEvent) {
	if (node.type !== TABLE_NODE_TYPE && node.type !== NOTE_NODE_TYPE) return;
	recomputeEdgesForNode(node.id);
}

function onNodeDragStop({ node }: NodeDragEvent) {
	const start = dragStartPositions.get(node.id);
	dragStartPositions.delete(node.id);
	if (!start) return;
	const newPos = { x: node.position.x, y: node.position.y };
	if (start.x === newPos.x && start.y === newPos.y) return;
	if (node.type === TABLE_NODE_TYPE) {
		const tableName = (node.data as { tableName?: string })?.tableName;
		if (!tableName) return;
		tablePositions.value[tableName] = newPos;
		pushOp({ kind: "tableMove", tableName, from: start, to: newPos });
	} else if (node.type === NOTE_NODE_TYPE) {
		const noteId = (node.data as { noteId?: string })?.noteId;
		if (!noteId) return;
		const local = notes.value.find((n) => n.id === noteId);
		if (!local) return;
		local.x = newPos.x;
		local.y = newPos.y;
		pushOp({ kind: "noteMove", noteId, from: start, to: newPos });
	}
}

function onNodeDoubleClick({ node }: NodeMouseEvent) {
	// Only real table nodes open the inspector; stub/note nodes are ignored.
	if (node.type !== TABLE_NODE_TYPE) return;
	const tableName = (node.data as { tableName?: string })?.tableName;
	if (tableName) emit("inspect-table", tableName);
}

function onNoteTextChange(noteId: string, newText: string) {
	const n = notes.value.find((x) => x.id === noteId);
	if (!n || n.text === newText) return;
	pushOp({ kind: "noteText", noteId, from: n.text, to: newText });
	n.text = newText;
	rebuildKey.value++;
}

function onNoteDelete(noteId: string) {
	const idx = notes.value.findIndex((n) => n.id === noteId);
	if (idx < 0) return;
	const snapshot = cloneNote(notes.value[idx] as NoteDraft);
	notes.value.splice(idx, 1);
	pushOp({ kind: "noteDelete", snapshot });
	rebuildKey.value++;
}

function addNote() {
	const id = effectiveSchemaId.value;
	if (!id) return;
	// Drop the note at the centre of the *visible* canvas. The pane centre is a
	// screen-space point; convert it to flow coordinates with the live viewport
	// (offset + zoom) so the note lands on-screen no matter how the user has
	// panned or zoomed — the old code read a stale {0,0,1} viewport and could
	// place notes far off-screen. Pane size comes from our own wrapper element
	// (the controller's `dimensions` ref isn't reliably populated here).
	const rect = canvasWrapper.value?.getBoundingClientRect();
	const vp = liveViewport.value;
	const paneW = rect?.width || NODE_WIDTH * 3;
	const paneH = rect?.height || NODE_HEIGHT_HEADER * 8;
	const x = (paneW / 2 - vp.x) / vp.zoom - NOTE_DEFAULT_WIDTH / 2;
	const y = (paneH / 2 - vp.y) / vp.zoom - NOTE_DEFAULT_HEIGHT / 2;
	tempCounter += 1;
	const tempId = `temp-${Date.now()}-${tempCounter}`;
	const draft: NoteDraft = {
		id: tempId,
		schemaName: id,
		text: "",
		x,
		y,
		width: NOTE_DEFAULT_WIDTH,
		height: NOTE_DEFAULT_HEIGHT,
		color: null,
		isTemp: true,
	};
	notes.value.push(draft);
	pushOp({ kind: "noteCreate", tempId, snapshot: cloneNote(draft) });
	rebuildKey.value++;
}

function runAutoLayout() {
	if (Object.keys(tablePositions.value).length === 0) {
		rebuildKey.value++;
		nextTick(() => fitView());
		return;
	}
	const from = clonePositions(tablePositions.value);
	tablePositions.value = {};
	pushOp({ kind: "autoLayout", from });
	rebuildKey.value++;
	nextTick(() => fitView());
}

function resetZoom() {
	canvas.value?.zoomTo(RESET_ZOOM);
}

function confirmLeave(): boolean {
	return window.confirm(t("dms_database.diagram.unsavedConfirm"));
}

function onBeforeUnload(e: BeforeUnloadEvent) {
	if (!isDirty.value) return;
	e.preventDefault();
	e.returnValue = "";
}

onMounted(() => {
	window.addEventListener("beforeunload", onBeforeUnload);
});

onBeforeUnmount(() => {
	window.removeEventListener("beforeunload", onBeforeUnload);
});

const { registerGuard } = usePageLeaveGuard();
registerGuard(() => {
	if (!isDirty.value) return true;
	return confirmLeave();
});
</script>

<template>
	<div
		ref="canvasWrapper"
		class="h-[calc(100vh-15rem)] min-h-[28rem] overflow-hidden rounded-xl border border-default"
		:class="panMode ? 'diagram-pan-mode' : 'diagram-select-mode'"
	>
		<DmsFlowCanvas
			ref="canvas"
			:node-types="nodeTypes"
			:edge-types="edgeTypes"
			:controls="false"
			:fit-view-on-init="false"
			:pan-on-drag="panMode"
			:nodes-draggable="!panMode"
			@nodes-initialized="onNodesInitialized"
			@viewport-change="onViewportChange"
			@node-drag-start="onNodeDragStart"
			@node-drag="onNodeDrag"
			@node-drag-stop="onNodeDragStop"
			@node-double-click="onNodeDoubleClick"
		>
			<template #top-right>
				<div
					class="flex items-center gap-1 rounded-lg border border-default bg-elevated p-1 shadow-md"
				>
					<UButton
						size="sm"
						variant="ghost"
						color="neutral"
						icon="i-ph-squares-four"
						:label="$t('dms_database.diagram.toolbar.autoLayout')"
						@click="runAutoLayout"
					/>
					<UTooltip :text="$t('dms_database.diagram.toolbar.helpText')">
						<UButton
							size="sm"
							variant="ghost"
							color="neutral"
							icon="i-ph-question"
							:aria-label="$t('dms_database.diagram.toolbar.help')"
						/>
					</UTooltip>
					<div class="w-px h-5 bg-default mx-1" />
					<UTooltip :text="$t('dms_database.diagram.toolbar.undo')">
						<UButton
							size="sm"
							variant="ghost"
							color="neutral"
							icon="i-ph-arrow-counter-clockwise"
							:aria-label="$t('dms_database.diagram.toolbar.undo')"
							:disabled="!canUndo || applying"
							@click="undo"
						/>
					</UTooltip>
					<UTooltip :text="$t('dms_database.diagram.toolbar.redo')">
						<UButton
							size="sm"
							variant="ghost"
							color="neutral"
							icon="i-ph-arrow-clockwise"
							:aria-label="$t('dms_database.diagram.toolbar.redo')"
							:disabled="!canRedo || applying"
							@click="redo"
						/>
					</UTooltip>
					<div class="w-px h-5 bg-default mx-1" />
					<UButton
						size="sm"
						variant="ghost"
						color="neutral"
						:label="$t('dms_database.diagram.toolbar.cancel')"
						:disabled="!isDirty || applying"
						@click="cancelChanges"
					/>
					<UButton
						size="sm"
						color="primary"
						:label="$t('dms_database.diagram.toolbar.apply')"
						:disabled="!isDirty"
						:loading="applying"
						@click="applyChanges"
					/>
				</div>
			</template>

			<template #bottom-center>
				<div
					class="flex items-center gap-1 rounded-lg border border-default bg-elevated p-1 shadow-md"
				>
					<UTooltip :text="$t('dms_database.diagram.toolbar.pointer')">
						<UButton
							size="sm"
							:color="panMode ? 'neutral' : 'primary'"
							:variant="panMode ? 'ghost' : 'solid'"
							icon="i-ph-cursor"
							:aria-pressed="!panMode"
							:aria-label="$t('dms_database.diagram.toolbar.pointer')"
							@click="panMode = false"
						/>
					</UTooltip>
					<UTooltip :text="$t('dms_database.diagram.toolbar.hand')">
						<UButton
							size="sm"
							:color="panMode ? 'primary' : 'neutral'"
							:variant="panMode ? 'solid' : 'ghost'"
							icon="i-ph-hand"
							:aria-pressed="panMode"
							:aria-label="$t('dms_database.diagram.toolbar.hand')"
							@click="panMode = true"
						/>
					</UTooltip>
					<div class="w-px h-5 bg-default mx-1" />
					<UTooltip :text="$t('dms_database.diagram.toolbar.zoomOut')">
						<UButton
							size="sm"
							variant="ghost"
							color="neutral"
							icon="i-ph-magnifying-glass-minus"
							:aria-label="$t('dms_database.diagram.toolbar.zoomOut')"
							@click="zoomOut()"
						/>
					</UTooltip>
					<UTooltip :text="$t('dms_database.diagram.toolbar.resetZoom')">
						<button
							type="button"
							class="px-2 text-sm text-muted tabular-nums hover:text-highlighted transition-colors"
							:aria-label="$t('dms_database.diagram.toolbar.resetZoom')"
							@click="resetZoom"
						>
							{{ zoomPercent }}
						</button>
					</UTooltip>
					<UTooltip :text="$t('dms_database.diagram.toolbar.zoomIn')">
						<UButton
							size="sm"
							variant="ghost"
							color="neutral"
							icon="i-ph-magnifying-glass-plus"
							:aria-label="$t('dms_database.diagram.toolbar.zoomIn')"
							@click="zoomIn()"
						/>
					</UTooltip>
					<UTooltip :text="$t('dms_database.diagram.toolbar.fitView')">
						<UButton
							size="sm"
							variant="ghost"
							color="neutral"
							icon="i-ph-arrows-out"
							:aria-label="$t('dms_database.diagram.toolbar.fitView')"
							@click="fitView()"
						/>
					</UTooltip>
					<div class="w-px h-5 bg-default mx-1" />
					<UTooltip :text="$t('dms_database.diagram.toolbar.notes')">
						<UButton
							size="sm"
							variant="ghost"
							color="neutral"
							icon="i-ph-text-t"
							:aria-label="$t('dms_database.diagram.toolbar.notes')"
							@click="addNote"
						/>
					</UTooltip>
				</div>
			</template>
		</DmsFlowCanvas>
	</div>
</template>

<style scoped>
/* Pan tool (hand): grab the empty canvas to move the view. Cursor tool keeps the
   default arrow so node drag / selection reads as the active interaction. The
   pane sits inside DmsFlowCanvas, hence :deep. */
.diagram-pan-mode :deep(.vue-flow__pane) {
	cursor: grab;
}
.diagram-pan-mode :deep(.vue-flow__pane.dragging) {
	cursor: grabbing;
}
</style>
