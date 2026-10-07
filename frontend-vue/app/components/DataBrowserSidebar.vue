<script setup lang="ts">
import { onKeyStroke } from "@vueuse/core";
import type { SchemaSummary } from "../composables/useDatabaseSchemas";

// The data browser's scope (D-04): a labelled schema picker, the instance as
// a segmented control explained in place ("all" is read-only), and the
// schema's tables with their row count in that instance. Open tables carry a
// dot.

const TABLES_ENDPOINT = "/api/database/browse/tables";

interface TableEntry {
	name: string;
	elementCount: number;
}

const props = defineProps<{ schemas: SchemaSummary[] }>();

const { t, n } = useI18n();
const { $authFetch } = useAuthFetch();
const { tabs, activeTab, openTab } = useDataBrowserTabs();
const route = useDmsRoute();

const schemaId = ref<string | null>(null);
const instance = ref<string>(DEFAULT_INSTANCE_VALUE);
const filter = ref("");
const filterInput = useTemplateRef<{ inputRef?: HTMLInputElement }>("filterInput");

// A schema-only link (?schema=X with no table) picks the schema; otherwise
// the active tab leads, then the first schema.
const linkedSchema =
	typeof route.query.schema === "string" && !route.query.table ? route.query.schema : null;
let userPicked = false;

watch(
	activeTab,
	(tab) => {
		if (!tab || userPicked) return;
		schemaId.value = tab.schema;
		instance.value = tab.instance;
	},
	{ immediate: true },
);

watch(
	() => props.schemas,
	(list) => {
		if (schemaId.value || list.length === 0) return;
		const linked = list.find((schema) => schema.id === linkedSchema);
		schemaId.value = linked?.id ?? list[0]?.id ?? null;
	},
	{ immediate: true },
);

function pickSchema(id: string) {
	userPicked = true;
	schemaId.value = id;
	// Named instances belong to one schema.
	instance.value = DEFAULT_INSTANCE_VALUE;
}

function pickInstance(id: string | number) {
	userPicked = true;
	instance.value = String(id);
}

const schema = computed(() => props.schemas.find((s) => s.id === schemaId.value) ?? null);
const schemaItems = computed(() =>
	props.schemas.map((s) => ({ label: s.id, value: s.id, icon: "i-ph-stack" })),
);
const instanceItems = computed(() => [
	{ label: t("dms_database.data.scope.default"), value: DEFAULT_INSTANCE_VALUE },
	...(schema.value?.instances ?? []).map((id) => ({ label: id, value: id })),
	{ label: t("dms_database.data.scope.all"), value: CROSS_INSTANCE_VALUE, icon: "i-ph-lock-simple" },
]);
const instanceName = computed(() =>
	instanceItems.value.find((item) => item.value === instance.value)?.label ?? instance.value,
);

// --- tables and their counts in the picked instance ---
const counts = ref<Record<string, number>>({});
const countsFailed = ref(false);

watch(
	[schemaId, instance],
	async ([id, picked]) => {
		counts.value = {};
		countsFailed.value = false;
		if (!id) return;
		const query: Record<string, string> = { filter_schema: isFilterToken(id) };
		if (picked !== DEFAULT_INSTANCE_VALUE) query.filter_instance = isFilterToken(picked);
		try {
			const res = await $authFetch<{ items: TableEntry[] }>(TABLES_ENDPOINT, { query });
			if (schemaId.value !== id || instance.value !== picked) return;
			counts.value = Object.fromEntries(res.items.map((item) => [item.name, item.elementCount]));
		} catch {
			if (schemaId.value === id) countsFailed.value = true;
		}
	},
	{ immediate: true },
);

const openIds = computed(() => new Set(tabs.value.map((tab) => tab.id)));

const tables = computed(() => {
	const needle = filter.value.trim().toLowerCase();
	return (schema.value?.tables ?? [])
		.filter((table) => !needle || table.name.toLowerCase().includes(needle))
		.map((table) => ({
			name: table.name,
			count: counts.value[table.name],
			open: openIds.value.has(`${schemaId.value}::${instance.value}::${table.name}`),
			active:
				activeTab.value?.schema === schemaId.value &&
				activeTab.value?.instance === instance.value &&
				activeTab.value?.table === table.name,
		}));
});

// A click opens a preview tab, a double-click (or a modified click) keeps it.
function open(name: string, event?: MouseEvent) {
	if (!schemaId.value) return;
	const keep = Boolean(event && (event.metaKey || event.ctrlKey || event.altKey));
	openTab(schemaId.value, instance.value, name, !keep);
}

function keep(name: string) {
	if (schemaId.value) openTab(schemaId.value, instance.value, name, false);
}

onKeyStroke("t", (event) => {
	const target = event.target as HTMLElement | null;
	if (target?.closest("input, textarea, [contenteditable=true]")) return;
	if (event.metaKey || event.ctrlKey || event.altKey) return;
	event.preventDefault();
	filterInput.value?.inputRef?.focus();
});
</script>

<template>
	<aside class="border-default bg-default flex h-full w-[264px] shrink-0 flex-col border-r">
		<div class="border-default grid gap-2 border-b p-3">
			<DmsEyebrow :label="t('dms_database.data.scope.schema')" />
			<USelect
				:model-value="schemaId ?? undefined"
				:items="schemaItems"
				:placeholder="t('dms_database.data.scope.schema')"
				icon="i-ph-stack"
				size="sm"
				class="w-full font-mono"
				@update:model-value="pickSchema(String($event))"
			/>
			<div class="mt-1 flex items-center justify-between">
				<DmsEyebrow :label="t('dms_database.data.scope.instance')" />
				<UTooltip :text="t('dms_database.data.scope.instance_help')">
					<span class="text-dimmed cursor-help text-[11px]">{{ t("dms_database.data.scope.whats_this") }}</span>
				</UTooltip>
			</div>
			<DmsSegmented
				:model-value="instance"
				:items="instanceItems"
				:aria-label="t('dms_database.data.scope.instance')"
				size="sm"
				variant="mono"
				overflow="wrap"
				block
				:disabled="!schemaId"
				@update:model-value="pickInstance"
			/>
		</div>

		<div class="flex min-h-0 flex-1 flex-col p-2">
			<UInput
				ref="filterInput"
				v-model="filter"
				icon="i-ph-magnifying-glass"
				size="sm"
				class="mb-2 w-full"
				:placeholder="t('dms_database.data.scope.find_table')"
				:disabled="!schemaId"
			>
				<template #trailing><UKbd value="T" size="sm" /></template>
			</UInput>
			<div class="flex items-center justify-between px-2 pb-1">
				<DmsEyebrow :label="t('dms_database.data.scope.tables', { count: tables.length })" />
				<DmsEyebrow :label="t('dms_database.data.scope.rows')" />
			</div>
			<nav class="min-h-0 flex-1 overflow-y-auto">
				<button
					v-for="table in tables"
					:key="table.name"
					type="button"
					class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors select-none"
					:class="table.active ? 'bg-primary/10 text-primary' : 'text-toned hover:bg-elevated'"
					:title="t('dms_database.data.scope.open_hint')"
					@click="open(table.name, $event)"
					@dblclick="keep(table.name)"
				>
					<UIcon
						name="i-ph-table"
						class="size-3.5 shrink-0"
						:class="table.active ? 'text-primary' : 'text-dimmed'"
					/>
					<span class="min-w-0 flex-1 truncate font-mono text-xs">{{ table.name }}</span>
					<span
						v-if="table.open && !table.active"
						class="bg-primary size-1.5 shrink-0 rounded-full"
						:title="t('dms_database.data.scope.open_tab')"
					/>
					<span v-if="table.count !== undefined" class="text-dimmed shrink-0 font-mono text-[10.5px] tabular-nums">
						{{ n(table.count) }}
					</span>
				</button>
				<p v-if="schemaId && tables.length === 0" class="text-muted px-2 py-4 text-center text-xs">
					{{ t("dms_database.data.scope.no_table") }}
				</p>
			</nav>
		</div>
		<footer class="border-default text-dimmed flex items-center gap-1.5 border-t px-3 py-2 text-[11.5px]">
			<UIcon :name="countsFailed ? 'i-ph-warning' : 'i-ph-info'" class="size-3.5 shrink-0" />
			<span v-if="countsFailed">{{ t("dms_database.data.scope.counts_failed") }}</span>
			<i18n-t v-else keypath="dms_database.data.scope.counts_for" tag="span">
				<template #instance><span class="text-primary font-mono">{{ instanceName }}</span></template>
			</i18n-t>
		</footer>
	</aside>
</template>
