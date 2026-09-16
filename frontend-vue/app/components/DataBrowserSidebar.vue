<script setup lang="ts">
import type { SchemaSummary } from "../composables/useDatabaseSchemas";

const TABLES_LIST_ENDPOINT = "/api/database/tables/list";
// Row-count fetch cap; mirrors the backend MAX_LIMIT for /api/database/tables.
const ROW_COUNT_FETCH_LIMIT = 200;

interface TableListRow {
	schema: string;
	name: string;
	columnCount: number;
	indexCount: number;
	elementCount: number;
}

const props = defineProps<{ schemas: SchemaSummary[] }>();

const { t } = useI18n();
const { $authFetch } = useAuthFetch();
const { activeTab, openTab } = useDataBrowserTabs();
const route = useDmsRoute();

const selectedSchemaId = ref<string | null>(null);
const selectedInstanceId = ref<string>(DEFAULT_INSTANCE_VALUE);
const tableSearch = ref("");

// A schema-only deep-link (?schema=X without table, e.g. "Open in data
// browser" on a schema card) pre-selects the pickers. Captured at setup:
// the tab restore may rewrite the URL before the schemas fetch resolves.
const initialQuerySchema =
	typeof route.query.schema === "string" && route.query.schema
		? route.query.schema
		: null;
const initialQueryInstance =
	typeof route.query.instance === "string" && route.query.instance
		? route.query.instance
		: null;
const initialQueryHasTable =
	typeof route.query.table === "string" && route.query.table.length > 0;

// How the pickers were last set. The active tab (restored tabs, deep-links)
// may override an automatic selection but never a user-driven one — so
// browsing another schema never loses the user's place, while a restore that
// lands AFTER the first-schema fallback still wins (the sidebar setup runs
// before the page's onMounted restore()).
type SelectionSource = "none" | "fallback" | "tab" | "user";
const selectionSource = ref<SelectionSource>("none");

watch(
	activeTab,
	(tab) => {
		if (!tab || selectionSource.value === "user") return;
		selectedSchemaId.value = tab.schema;
		selectedInstanceId.value = tab.instance;
		selectionSource.value = "tab";
	},
	{ immediate: true },
);
watch(
	() => props.schemas,
	(schemas) => {
		if (selectionSource.value !== "none" || schemas.length === 0) return;
		// A schema-only deep-link wins over the first-schema fallback and, being
		// an explicit user request, is not overridden by a restored tab either.
		if (
			initialQuerySchema &&
			!initialQueryHasTable &&
			schemas.some((schema) => schema.id === initialQuerySchema)
		) {
			selectedSchemaId.value = initialQuerySchema;
			selectedInstanceId.value = initialQueryInstance ?? DEFAULT_INSTANCE_VALUE;
			selectionSource.value = "user";
			return;
		}
		selectedSchemaId.value = schemas[0]?.id ?? null;
		selectionSource.value = "fallback";
	},
	{ immediate: true },
);

// User-driven picker changes (the USelects emit update:model-value only for
// user interaction, not for the programmatic assignments above).
function onUserSchemaChange() {
	selectionSource.value = "user";
	// Named instances belong to one schema; reset when the user switches.
	selectedInstanceId.value = DEFAULT_INSTANCE_VALUE;
}
function onUserInstanceChange() {
	selectionSource.value = "user";
}

const currentSchema = computed(
	() => props.schemas.find((schema) => schema.id === selectedSchemaId.value) ?? null,
);

const schemaOptions = computed(() =>
	props.schemas.map((schema) => ({ label: schema.id, value: schema.id })),
);
const instanceOptions = computed(() => {
	const options = [
		{ label: t("dms_database.data.instanceDefault"), value: DEFAULT_INSTANCE_VALUE },
	];
	for (const id of currentSchema.value?.instances ?? []) {
		options.push({ label: id, value: id });
	}
	options.push({
		label: t("dms_database.data.instanceCross"),
		value: CROSS_INSTANCE_VALUE,
	});
	return options;
});

// --- row counts (best effort, display only) ---
const rowCounts = ref<Record<string, number>>({});
// No explicit locale: let the runtime format with the browser's preference.
const countFormatter = new Intl.NumberFormat();

watch(
	[selectedSchemaId, selectedInstanceId],
	async ([schemaId, instanceId]) => {
		rowCounts.value = {};
		if (!schemaId) return;
		const query: Record<string, string | number> = {
			filter_schema: isFilterToken(schemaId),
			limit: ROW_COUNT_FETCH_LIMIT,
		};
		// Counts follow the instance picker (backend defaults to the base
		// instance when the filter is absent).
		if (instanceId !== DEFAULT_INSTANCE_VALUE) {
			query.filter_instance = isFilterToken(instanceId);
		}
		const isCurrent = () =>
			selectedSchemaId.value === schemaId &&
			selectedInstanceId.value === instanceId;
		try {
			const res = await $authFetch<{ results: TableListRow[] }>(
				TABLES_LIST_ENDPOINT,
				{ query },
			);
			// Ignore a response that arrived after the user switched selection.
			if (!isCurrent()) return;
			const counts: Record<string, number> = {};
			for (const row of res.results ?? []) counts[row.name] = row.elementCount;
			rowCounts.value = counts;
		} catch {
			// Only clear when the failure concerns the current selection — a late
			// failure from a previous one must not wipe fresh counts.
			if (isCurrent()) rowCounts.value = {};
		}
	},
	{ immediate: true },
);

const visibleTables = computed(() => {
	const needle = tableSearch.value.trim().toLowerCase();
	const tables = currentSchema.value?.tables ?? [];
	const filtered = needle
		? tables.filter((table) => table.name.toLowerCase().includes(needle))
		: tables;
	return filtered.map((table) => ({
		name: table.name,
		count: rowCounts.value[table.name] ?? null,
	}));
});

function isActive(tableName: string): boolean {
	const tab = activeTab.value;
	return (
		tab !== null &&
		tab.schema === selectedSchemaId.value &&
		tab.instance === selectedInstanceId.value &&
		tab.table === tableName
	);
}

// Single click opens as a preview; double-click opens permanently (VS Code
// explorer behaviour — the first click already opened the preview, the second
// pins it). A modified click (cmd/ctrl/alt) also opens permanently: it is the
// keyboard path to a pinned open, since Enter can never produce a dblclick.
function open(tableName: string, preview = true) {
	if (!selectedSchemaId.value) return;
	openTab(selectedSchemaId.value, selectedInstanceId.value, tableName, preview);
}
</script>

<template>
	<aside class="flex h-full w-[270px] shrink-0 flex-col border-r border-default bg-default">
		<div class="space-y-2 border-b border-default p-3">
			<USelect
				v-model="selectedSchemaId"
				:items="schemaOptions"
				:placeholder="$t('dms_database.data.schema')"
				icon="i-ph-stack"
				size="sm"
				class="w-full"
				@update:model-value="onUserSchemaChange"
			/>
			<USelect
				v-model="selectedInstanceId"
				:items="instanceOptions"
				:disabled="!selectedSchemaId"
				icon="i-ph-tree-structure"
				size="sm"
				class="w-full"
				@update:model-value="onUserInstanceChange"
			/>
			<UInput
				v-model="tableSearch"
				:placeholder="$t('dms_database.data.findTable')"
				:disabled="!selectedSchemaId"
				icon="i-ph-magnifying-glass"
				size="sm"
				class="w-full"
			/>
		</div>
		<nav class="flex-1 overflow-y-auto p-1.5">
			<button
				v-for="table in visibleTables"
				:key="table.name"
				type="button"
				class="flex w-full select-none items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
				:class="
					isActive(table.name)
						? 'bg-primary/10 text-primary'
						: 'text-toned hover:bg-elevated'
				"
				@click="open(table.name, !($event.metaKey || $event.ctrlKey || $event.altKey))"
				@dblclick="open(table.name, false)"
			>
				<UIcon
					name="i-ph-table"
					class="size-3.5 shrink-0"
					:class="isActive(table.name) ? 'text-primary' : 'text-dimmed'"
				/>
				<span class="min-w-0 flex-1 truncate font-mono text-xs">{{ table.name }}</span>
				<span
					v-if="table.count !== null"
					class="shrink-0 text-[10px] tabular-nums text-dimmed"
				>
					{{ countFormatter.format(table.count) }}
				</span>
			</button>
			<p
				v-if="selectedSchemaId && visibleTables.length === 0"
				class="px-2 py-4 text-center text-xs text-muted"
			>
				{{ $t("dms_database.overview.tables.empty") }}
			</p>
			<p v-else-if="!selectedSchemaId" class="px-2 py-4 text-center text-xs text-muted">
				{{ $t("dms_database.data.pickPrompt") }}
			</p>
		</nav>
	</aside>
</template>
