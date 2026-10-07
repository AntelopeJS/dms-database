<script setup lang="ts">
import { useClipboard } from "@vueuse/core";
import type { FieldDescriptor } from "../composables/useDatabaseSchemas";
import {
	COLUMN_ROLE_CLASSES,
	type ColumnRole,
	describeField,
	describeModifier,
	isPrimaryKey,
} from "../utils/fieldTypes";
import { tableLink } from "../utils/databaseLinks";

// The Schemas page's row drawer (D-07): the facts of one table, its columns,
// indexes and relations both ways, and a sample row. The table view hands it
// the row it lists and the means to step to the next one (J / K).

interface TableRow {
	schema: string;
	name: string;
	/** Rows in the default instance; unknown when opened from the diagram. */
	elementCount?: number;
}

interface RowNavigation {
	index: number;
	total: number;
	hasPrev: boolean;
	hasNext: boolean;
	prev: () => void;
	next: () => void;
}

const props = defineProps<{
	rowData?: TableRow;
	navigation?: RowNavigation;
}>();

type InspectorTab = "columns" | "indexes" | "relations" | "sample";

// Descriptor kinds that admit an empty value on their own.
const NULLISH_KINDS = new Set<FieldDescriptor["kind"]>([
	"null",
	"undefined",
	"any",
	"unknown",
]);
const BROWSE_LIST = "/api/database/browse/list";

const { t, n } = useI18n();
const { $authFetch } = useAuthFetch();
const { schemas, findTable, inboundRelations } = useDatabaseSchemas();
const { copy } = useClipboard();
const toast = useToast();

const tab = ref<InspectorTab>("columns");
const schemaId = computed(() => props.rowData?.schema ?? "");
const tableName = computed(() => props.rowData?.name ?? "");
const table = computed(() => findTable(schemaId.value, tableName.value));
const schema = computed(() => schemas.value.find((s) => s.id === schemaId.value));
const instanceCount = computed(() => schema.value?.stats.instanceCount ?? 1);
const address = computed(() => ({ schema: schemaId.value, table: tableName.value }));

function isNullable(descriptor: FieldDescriptor): boolean {
	if (NULLISH_KINDS.has(descriptor.kind)) return true;
	return (
		descriptor.kind === "union" &&
		descriptor.members.some((m) => m.kind === "null" || m.kind === "undefined")
	);
}

const relationByField = computed(
	() => new Map((table.value?.relations ?? []).map((r) => [r.fromField, r])),
);

const columns = computed(() => {
	const current = table.value;
	if (!current) return [];
	return Object.entries(current.fields).map(([name, descriptor]) => {
		const relation = relationByField.value.get(name);
		const key = isPrimaryKey(name, current.indexes ?? {});
		const role: ColumnRole = key ? "key" : relation ? "relation" : "plain";
		const type = describeField(descriptor, name);
		return {
			name,
			role,
			icon: key ? "i-ph-key" : relation ? "i-ph-arrow-right" : type.icon,
			label: key
				? t("dms_database.inspector.primary_key")
				: relation
					? relation.toTable
					: type.label,
			nullable: !key && isNullable(descriptor),
			modifiers: (current.modifiers?.[name] ?? []).map(describeModifier),
		};
	});
});

const indexes = computed(() =>
	Object.entries(table.value?.indexes ?? {}).map(([name, index]) => ({
		name,
		fields: index.fields ?? [],
		compound: (index.fields?.length ?? 0) > 1,
		multi: Boolean(index.multi),
	})),
);

const outgoing = computed(() =>
	(table.value?.relations ?? []).map((r) => ({
		key: `out-${r.fromField}`,
		from: `${tableName.value}.${r.fromField}`,
		to: `${r.toSchema === schemaId.value ? "" : `${r.toSchema}.`}${r.toTable}.${r.toField}`,
		cardinality: r.many ? "N : N" : "N : 1",
		link: tableLink("schemas", { schema: r.toSchema, table: r.toTable }),
	})),
);

const incoming = computed(() =>
	inboundRelations(schemaId.value, tableName.value).map((r) => ({
		key: `in-${r.fromSchema}-${r.fromTable}-${r.fromField}`,
		from: `${r.fromSchema === schemaId.value ? "" : `${r.fromSchema}.`}${r.fromTable}.${r.fromField}`,
		to: `${tableName.value}.${r.toField}`,
		cardinality: r.many ? "N : N" : "N : 1",
	})),
);

const rowsFact = computed(() => {
	const count = props.rowData?.elementCount;
	return count === undefined
		? []
		: [t("dms_database.inspector.facts.rows", { count: n(count) }, count)];
});

const facts = computed(() =>
	[
		...rowsFact.value,
		t("dms_database.inspector.facts.columns", columns.value.length),
		t("dms_database.inspector.facts.indexes", indexes.value.length),
		t(
			"dms_database.inspector.facts.relations",
			outgoing.value.length + incoming.value.length,
		),
	].join(" · "),
);

const tabs = computed(() => [
	{ value: "columns", label: t("dms_database.inspector.tabs.columns"), badge: columns.value.length },
	{ value: "indexes", label: t("dms_database.inspector.tabs.indexes"), badge: indexes.value.length },
	{
		value: "relations",
		label: t("dms_database.inspector.tabs.relations"),
		badge: outgoing.value.length + incoming.value.length,
	},
	{ value: "sample", label: t("dms_database.inspector.tabs.sample") },
]);

// --- sample row: the latest row, or the next one on demand ---
const sample = ref<Record<string, unknown> | null>(null);
const sampleOffset = ref(0);
const sampleTotal = ref(0);
const sampleLoading = ref(false);
const sampleFailed = ref(false);

async function loadSample() {
	if (!schemaId.value || !tableName.value) return;
	sampleLoading.value = true;
	sampleFailed.value = false;
	try {
		const res = await $authFetch<{ results: Record<string, unknown>[]; total: number }>(
			BROWSE_LIST,
			{
				query: {
					filter_schema: `is:${schemaId.value}`,
					filter_table: `is:${tableName.value}`,
					offset: sampleOffset.value,
					limit: 1,
				},
			},
		);
		sample.value = res.results?.[0] ?? null;
		sampleTotal.value = res.total ?? 0;
	} catch {
		sampleFailed.value = true;
		sample.value = null;
	} finally {
		sampleLoading.value = false;
	}
}

function nextSample() {
	sampleOffset.value = sampleTotal.value > 0 ? (sampleOffset.value + 1) % sampleTotal.value : 0;
	loadSample();
}

watch(tab, (value) => {
	if (value === "sample" && !sample.value && !sampleLoading.value) loadSample();
});

const sampleJson = computed(() =>
	sample.value ? JSON.stringify(sample.value, null, 2) : "",
);

async function copyName() {
	await copy(tableName.value);
	toast.add({
		title: t("dms_database.inspector.copied", { name: tableName.value }),
		color: "success",
		icon: "i-ph-check",
	});
}
</script>

<template>
	<div class="flex h-full w-full flex-col gap-4">
		<header class="grid gap-3">
			<div class="flex items-center gap-2">
				<DmsEyebrow :label="t('dms_database.inspector.eyebrow', { schema: schemaId })" />
				<span class="flex-1" />
				<template v-if="navigation">
					<span class="text-dimmed font-mono text-[11px] tabular-nums">
						{{ navigation.index + 1 }} / {{ navigation.total }}
					</span>
					<UButton
						icon="i-ph-caret-up"
						color="neutral"
						variant="ghost"
						size="xs"
						:disabled="!navigation.hasPrev"
						:aria-label="t('dms_database.inspector.previous')"
						:title="t('dms_database.inspector.previous')"
						@click="navigation.prev()"
					/>
					<UButton
						icon="i-ph-caret-down"
						color="neutral"
						variant="ghost"
						size="xs"
						:disabled="!navigation.hasNext"
						:aria-label="t('dms_database.inspector.next')"
						:title="t('dms_database.inspector.next')"
						@click="navigation.next()"
					/>
				</template>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<h3 class="text-highlighted font-mono text-lg font-semibold">{{ tableName }}</h3>
				<UBadge color="neutral" variant="outline" size="sm" class="font-mono">
					{{ t("dms_database.inspector.instances", instanceCount) }}
				</UBadge>
				<UButton
					icon="i-ph-copy"
					color="neutral"
					variant="ghost"
					size="xs"
					:aria-label="t('dms_database.inspector.copy_name')"
					:title="t('dms_database.inspector.copy_name')"
					@click="copyName"
				/>
			</div>
			<p class="text-muted text-sm tabular-nums">{{ facts }}</p>
			<div class="flex flex-wrap gap-2">
				<UButton
					:to="tableLink('data', address)"
					icon="i-ph-rows"
					size="sm"
					:label="t('dms_database.inspector.actions.browse')"
				/>
				<UButton
					:to="tableLink('query', address)"
					icon="i-ph-code"
					size="sm"
					color="neutral"
					variant="outline"
					:label="t('dms_database.inspector.actions.query')"
				/>
				<UButton
					:to="tableLink('diagram', address)"
					icon="i-ph-graph"
					size="sm"
					color="neutral"
					variant="ghost"
					:label="t('dms_database.inspector.actions.diagram')"
				/>
			</div>
			<UTabs v-model="tab" :items="tabs" variant="link" size="sm" :content="false" />
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto">
			<table v-if="tab === 'columns'" class="w-full text-sm">
				<thead>
					<tr class="border-default border-b text-left">
						<th class="text-dimmed py-2 pr-3 text-xs font-semibold">
							{{ t("dms_database.inspector.cols.column") }}
						</th>
						<th class="text-dimmed px-3 py-2 text-xs font-semibold">
							{{ t("dms_database.inspector.cols.type") }}
						</th>
						<th class="text-dimmed px-3 py-2 text-xs font-semibold">
							{{ t("dms_database.inspector.cols.null") }}
						</th>
						<th class="text-dimmed py-2 pl-3 text-xs font-semibold">
							{{ t("dms_database.inspector.cols.notes") }}
						</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="column in columns"
						:key="column.name"
						class="border-default/60 border-b last:border-0"
					>
						<td class="text-highlighted py-2 pr-3 font-mono text-[12.5px]">
							{{ column.name }}
						</td>
						<td class="px-3 py-2">
							<span
								class="inline-flex items-center gap-1.5 font-mono text-[11.5px]"
								:class="COLUMN_ROLE_CLASSES[column.role]"
							>
								<UIcon :name="column.icon" class="size-3.5 shrink-0" />
								{{ column.label }}
							</span>
						</td>
						<td class="px-3 py-2">
							<span
								v-if="column.nullable"
								class="text-dimmed rounded border border-dashed border-current px-1 font-mono text-[10.5px]"
								>null</span
							>
							<span v-else class="text-dimmed">—</span>
						</td>
						<td class="text-muted py-2 pl-3 text-xs">
							<span
								v-for="modifier in column.modifiers"
								:key="modifier.id"
								class="mr-2 inline-flex items-center gap-1"
							>
								<UIcon :name="modifier.icon" class="size-3.5" />
								{{ modifier.labelKey ? t(modifier.labelKey) : modifier.id }}
							</span>
						</td>
					</tr>
				</tbody>
			</table>

			<div v-else-if="tab === 'indexes'" class="grid gap-2">
				<div
					v-for="index in indexes"
					:key="index.name"
					class="border-default flex items-center gap-3 rounded-md border px-3 py-2.5"
				>
					<UBadge
						:color="index.compound ? 'primary' : 'neutral'"
						variant="subtle"
						size="sm"
						class="font-mono"
					>
						{{
							index.compound
								? t("dms_database.inspector.index.compound")
								: t("dms_database.inspector.index.single")
						}}
					</UBadge>
					<span class="text-toned font-mono text-[12.5px]">{{ index.name }}</span>
					<span class="ml-auto flex flex-wrap justify-end gap-1">
						<span
							v-for="field in index.fields"
							:key="field"
							class="bg-elevated text-muted rounded px-1.5 py-0.5 font-mono text-[11px]"
							>{{ field }}</span
						>
					</span>
				</div>
				<DmsEmptyState
					v-if="indexes.length === 0"
					size="sm"
					icon="i-ph-key"
					:title="t('dms_database.inspector.index.empty')"
				/>
			</div>

			<div v-else-if="tab === 'relations'" class="grid gap-5">
				<section class="grid gap-2">
					<DmsEyebrow :label="t('dms_database.inspector.relations.out', { count: outgoing.length })" />
					<DmsAutoLink
						v-for="relation in outgoing"
						:key="relation.key"
						:to="relation.link"
						class="border-default hover:bg-elevated/50 grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 rounded-md border px-3 py-2 font-mono text-[12px]"
					>
						<span class="text-toned truncate">{{ relation.from }}</span>
						<UIcon name="i-ph-arrow-right" class="text-info size-3.5" />
						<span class="text-info truncate">{{ relation.to }}</span>
						<span class="text-dimmed text-[10.5px]">{{ relation.cardinality }}</span>
					</DmsAutoLink>
					<p v-if="outgoing.length === 0" class="text-dimmed text-sm">
						{{ t("dms_database.inspector.relations.none_out") }}
					</p>
				</section>
				<section class="grid gap-2">
					<DmsEyebrow :label="t('dms_database.inspector.relations.in', { count: incoming.length })" />
					<div
						v-for="relation in incoming"
						:key="relation.key"
						class="border-default grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 rounded-md border px-3 py-2 font-mono text-[12px]"
					>
						<span class="text-info truncate">{{ relation.from }}</span>
						<UIcon name="i-ph-arrow-right" class="text-info size-3.5" />
						<span class="text-toned truncate">{{ relation.to }}</span>
						<span class="text-dimmed text-[10.5px]">{{ relation.cardinality }}</span>
					</div>
					<p v-if="incoming.length === 0" class="text-dimmed text-sm">
						{{ t("dms_database.inspector.relations.none_in") }}
					</p>
				</section>
			</div>

			<div v-else class="grid gap-3">
				<div class="flex items-center justify-between gap-2">
					<DmsEyebrow
						:label="
							t('dms_database.inspector.sample.position', {
								position: sampleTotal ? sampleOffset + 1 : 0,
								total: sampleTotal,
							})
						"
					/>
					<UButton
						icon="i-ph-arrows-clockwise"
						color="neutral"
						variant="ghost"
						size="xs"
						:disabled="sampleTotal < 2"
						:loading="sampleLoading"
						:label="t('dms_database.inspector.sample.another')"
						@click="nextSample"
					/>
				</div>
				<DmsEmptyState
					v-if="sampleFailed"
					size="sm"
					variant="error"
					:title="t('dms_database.inspector.sample.error')"
					:actions="[{ label: t('dms_database.common.retry'), icon: 'i-ph-arrows-clockwise', onClick: loadSample }]"
				/>
				<DmsEmptyState
					v-else-if="!sampleLoading && !sample"
					size="sm"
					:title="t('dms_database.inspector.sample.empty')"
				/>
				<pre
					v-else-if="sample"
					class="border-default bg-elevated/40 text-toned overflow-auto rounded-lg border p-4 font-mono text-xs whitespace-pre"
					>{{ sampleJson }}</pre
				>
			</div>
		</div>
	</div>
</template>
