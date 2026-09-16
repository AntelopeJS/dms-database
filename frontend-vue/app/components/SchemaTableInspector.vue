<script setup lang="ts">
import type {
	FieldDescriptor,
	TableSummary,
} from "../composables/useDatabaseSchemas";
import { inferFieldTypeIcon, isPrimaryKey } from "../utils/databaseFieldTypeIcons";

// Body panel for the shared dms drawer (useDrawer). The drawer owns the chrome
// (themed surface, header with the table name + subtitle, close button); this
// component only renders the inspector content: columns / indexes / preview
// tabs and the footer. It is opened from schemas.vue via `useDrawer().open()`.

// Descriptor kinds that admit null/undefined on their own: an explicit
// null/undefined, or an untyped any/unknown.
const NULLISH_KINDS = new Set<FieldDescriptor["kind"]>([
	"null",
	"undefined",
	"any",
	"unknown",
]);

// A field is nullable when its descriptor admits null/undefined — directly, as
// an untyped any/unknown, or as a member of a union. Anything else is required.
function isNullable(descriptor: FieldDescriptor): boolean {
	if (NULLISH_KINDS.has(descriptor.kind)) return true;
	if (descriptor.kind === "union") {
		return descriptor.members.some(
			(member) => member.kind === "null" || member.kind === "undefined",
		);
	}
	return false;
}

interface Props {
	schemaId: string | null;
	table: TableSummary | null;
	// Injected by the shared DynamicDrawer; unused here (read-only panel).
	containerId?: string;
}

const props = defineProps<Props>();

// The shared DynamicDrawer dismisses the drawer when the body emits `success`.
const emit = defineEmits<{ success: [] }>();

const { t } = useI18n();
const router = useDmsRouter();
const { $authFetch } = useAuthFetch();

const DATA_PATH = "/modules/database/data";
const BROWSE_LIST = "/api/database/browse/list";
const FILTER_MODE_IS = "is";

type Tab = "columns" | "indexes" | "preview";
const tab = ref<Tab>("columns");

const tabItems = computed(() => [
	{ label: t("dms_database.schemas.inspector.columns"), value: "columns" as const, icon: "i-ph-layout" },
	{ label: t("dms_database.schemas.inspector.indexes"), value: "indexes" as const, icon: "i-ph-key" },
	{ label: t("dms_database.schemas.inspector.preview"), value: "preview" as const, icon: "i-ph-table" },
]);

const fieldEntries = computed(() =>
	Object.entries(props.table?.fields ?? {}).map(([name, descriptor]) => {
		const meta = inferFieldTypeIcon(descriptor, name);
		const pk = isPrimaryKey(name, props.table?.indexes ?? {});
		// Primary keys are never nullable; otherwise read it off the descriptor.
		const nullable = pk ? false : isNullable(descriptor);
		return { name, meta, pk, nullable };
	}),
);

const indexEntries = computed(() =>
	Object.entries(props.table?.indexes ?? {}).map(([name, def]) => ({
		name,
		fields: def.fields ?? [],
		multi: Boolean(def.multi),
	})),
);

// --- preview (single sample row) ---
const previewRow = ref<Record<string, unknown> | null>(null);
const previewLoading = ref(false);
const previewError = ref(false);
const previewLoadedFor = ref<string | null>(null);

async function loadPreview() {
	if (!props.schemaId || !props.table) return;
	const key = `${props.schemaId}::${props.table.name}`;
	if (previewLoadedFor.value === key) return;
	previewLoading.value = true;
	previewError.value = false;
	try {
		const res = await $authFetch<{ results: Record<string, unknown>[] }>(
			BROWSE_LIST,
			{
				query: {
					filter_schema: `${FILTER_MODE_IS}:${props.schemaId}`,
					filter_table: `${FILTER_MODE_IS}:${props.table.name}`,
					limit: 1,
				},
			},
		);
		previewRow.value = res.results?.[0] ?? null;
		previewLoadedFor.value = key;
	} catch {
		previewError.value = true;
		previewRow.value = null;
	} finally {
		previewLoading.value = false;
	}
}

const previewJson = computed(() =>
	previewRow.value ? JSON.stringify(previewRow.value, null, 2) : "",
);

// The panel is mounted only while the drawer is open, so the preview loads as
// soon as its tab is selected (no `open` prop to gate on anymore).
watch(
	() => [tab.value, props.table?.name] as const,
	() => {
		if (tab.value === "preview") loadPreview();
	},
);

const browseTo = computed(() => {
	if (!props.schemaId || !props.table) return DATA_PATH;
	return `${DATA_PATH}?schema=${encodeURIComponent(props.schemaId)}&table=${encodeURIComponent(props.table.name)}`;
});

// "Browse data" navigates to the data browser and closes the drawer so the user
// lands on the table without the panel lingering over it.
function browseData() {
	router.push(browseTo.value);
	emit("success");
}
</script>

<template>
	<!-- Fixed width so the right-side drawer keeps a stable, comfortable size
	     instead of shrinking/growing with the active tab's content (the shared
	     DynamicDrawer sizes a right drawer to its content and exposes no width). -->
	<div class="flex h-full w-[36rem] max-w-[calc(100vw-3rem)] flex-col">
		<!-- tabs -->
		<div class="border-b border-default pb-3">
			<DmsSegmented v-model="tab" :items="tabItems" />
		</div>

		<!-- body -->
		<div class="flex-1 overflow-y-auto py-4">
			<!-- columns -->
			<table v-if="tab === 'columns'" class="w-full text-sm">
				<thead>
					<tr class="border-b border-default text-left">
						<th class="text-dimmed py-2 pr-3 text-xs font-semibold">
							{{ $t("dms_database.schemas.inspector.colName") }}
						</th>
						<th class="text-dimmed py-2 px-3 text-xs font-semibold">
							{{ $t("dms_database.schemas.inspector.colType") }}
						</th>
						<th class="text-dimmed py-2 pl-3 text-xs font-semibold">
							{{ $t("dms_database.schemas.inspector.colNullable") }}
						</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="field in fieldEntries"
						:key="field.name"
						class="border-b border-default/60 last:border-0"
					>
						<td class="py-2 pr-3">
							<span class="flex items-center gap-2 font-mono text-toned">
								<UIcon
									:name="field.pk ? 'i-ph-key' : field.meta.icon"
									class="size-3.5 shrink-0"
									:class="field.pk ? 'text-warning' : field.meta.color"
								/>
								{{ field.name }}
							</span>
						</td>
						<td class="py-2 px-3">
							<span
								class="font-mono text-[11px]"
								:class="field.meta.color"
							>
								{{ field.pk ? "pk" : field.meta.label }}
							</span>
						</td>
						<td class="py-2 pl-3 text-dimmed">
							{{
								field.nullable
									? $t("dms_database.schemas.inspector.yes")
									: $t("dms_database.schemas.inspector.no")
							}}
						</td>
					</tr>
				</tbody>
			</table>

			<!-- indexes -->
			<div v-else-if="tab === 'indexes'" class="space-y-2.5">
				<div
					v-for="idx in indexEntries"
					:key="idx.name"
					class="flex items-center gap-3 rounded-md border border-default bg-default px-3 py-2.5"
				>
					<UBadge
						:color="idx.multi ? 'info' : 'neutral'"
						variant="soft"
						size="sm"
					>
						{{
							idx.multi
								? $t("dms_database.schemas.inspector.multi")
								: $t("dms_database.schemas.inspector.single")
						}}
					</UBadge>
					<span class="font-mono text-[12.5px] text-toned">{{ idx.name }}</span>
					<span
						v-if="idx.fields.length"
						class="font-mono text-[11px] text-dimmed ml-auto truncate"
					>
						{{ idx.fields.join(", ") }}
					</span>
				</div>
				<p
					v-if="indexEntries.length === 0"
					class="text-dimmed text-sm py-6 text-center"
				>
					{{ $t("dms_database.schemas.inspector.noIndexes") }}
				</p>
			</div>

			<!-- preview -->
			<div v-else>
				<div v-if="previewLoading" class="py-10 text-center">
					<UProgress size="sm" />
				</div>
				<div
					v-else-if="previewError"
					class="text-dimmed text-sm py-10 text-center"
				>
					{{ $t("dms_database.schemas.inspector.previewError") }}
				</div>
				<div
					v-else-if="!previewRow"
					class="text-dimmed text-sm py-10 text-center"
				>
					{{ $t("dms_database.schemas.inspector.previewEmpty") }}
				</div>
				<pre
					v-else
					class="text-xs rounded-lg border border-default bg-default p-4 overflow-auto whitespace-pre text-toned"
					>{{ previewJson }}</pre
				>
			</div>
		</div>

		<!-- footer -->
		<div class="flex items-center gap-2 border-t border-default pt-4">
			<span class="flex items-center gap-1.5 text-xs text-success">
				<UIcon name="i-ph-check-circle" class="size-3.5" />
				{{ $t("dms_database.schemas.inspector.healthy") }}
			</span>
			<UButton
				color="neutral"
				variant="outline"
				size="sm"
				icon="i-ph-rows"
				:label="$t('dms_database.schemas.browseData')"
				class="ml-auto"
				@click="browseData"
			/>
		</div>
	</div>
</template>
