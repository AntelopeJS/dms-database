<script setup lang="ts">
import type { ExecuteResult } from "../composables/useQueryStore";

type ResultMode = "table" | "json" | "chart";

interface Props {
	result: ExecuteResult | null;
	mode: ResultMode;
}

const props = defineProps<Props>();

const emit = defineEmits<{
	"update:mode": [value: ResultMode];
}>();

const { t } = useI18n();

const internalMode = computed<ResultMode>({
	get: () => props.mode,
	set: (value) => emit("update:mode", value),
});

const modeItems = computed(() => [
	{ label: t("dms_database.query.table"), value: "table" as const },
	{ label: t("dms_database.query.json"), value: "json" as const },
	{ label: t("dms_database.query.chart"), value: "chart" as const },
]);

const columns = computed<string[]>(() => {
	const rows = props.result?.rows ?? [];
	const first = rows[0];
	if (!first || typeof first !== "object") return [];
	return Object.keys(first as Record<string, unknown>);
});

const rows = computed(() => props.result?.rows ?? []);

const jsonText = computed(() =>
	props.result ? JSON.stringify(props.result.rows, null, 2) : "",
);

function renderCell(value: unknown): string {
	if (value === null || value === undefined) return "—";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function isNumeric(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

// --- chart derivation (first numeric column, labelled by first string column) ---
const numericColumn = computed<string | null>(() => {
	const first = rows.value[0] as Record<string, unknown> | undefined;
	if (!first) return null;
	return columns.value.find((c) => isNumeric(first[c])) ?? null;
});

const labelColumn = computed<string | null>(() => {
	const first = rows.value[0] as Record<string, unknown> | undefined;
	if (!first) return null;
	return (
		columns.value.find(
			(c) => c !== numericColumn.value && typeof first[c] === "string",
		) ?? null
	);
});

const chartAvailable = computed(
	() => rows.value.length > 0 && numericColumn.value !== null,
);

const chartDataset = computed(() => {
	const col = numericColumn.value;
	if (!col) return [];
	const label = labelColumn.value;
	return [
		{
			name: col,
			data: rows.value.map((row, index) => {
				const record = row as Record<string, unknown>;
				return {
					x: label ? String(record[label]) : index + 1,
					y: isNumeric(record[col]) ? (record[col] as number) : 0,
				};
			}),
		},
	];
});
</script>

<template>
	<DmsCard>
		<!-- status bar -->
		<div class="flex flex-wrap items-center gap-2.5 mb-4">
			<UIcon
				:name="
					result?.error ? 'i-ph-x-circle-fill' : 'i-ph-check-circle-fill'
				"
				:class="result?.error ? 'text-error' : 'text-success'"
				class="size-4"
			/>
			<b class="text-highlighted text-[15px]">
				{{ $t("dms_database.query.result") }}
			</b>
			<template v-if="result && !result.error">
				<UBadge color="success" variant="soft" size="sm" class="font-mono">
					{{ $t("dms_database.query.rowCount", { count: rows.length }, rows.length) }}
				</UBadge>
				<span class="text-dimmed font-mono text-xs">
					{{ $t("dms_database.query.runtime", { ms: result.durationMs }) }}
				</span>
			</template>
			<DmsSegmented
				v-model="internalMode"
				:items="modeItems"
				:aria-label="$t('dms_database.query.result')"
				class="ml-auto"
			/>
		</div>

		<!-- body -->
		<div class="min-h-64">
			<div
				v-if="!result"
				class="flex flex-col items-center justify-center gap-3 py-16 text-dimmed"
			>
				<UIcon name="i-ph-code" class="text-4xl text-dimmed/60" />
				<p class="text-sm">{{ $t("dms_database.query.emptyResult") }}</p>
			</div>

			<div
				v-else-if="result.error"
				class="rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error whitespace-pre-wrap"
			>
				<p class="font-semibold mb-1">
					{{ $t("dms_database.query.errorTitle") }}
				</p>
				<p>{{ result.error }}</p>
			</div>

			<!-- table -->
			<div v-else-if="internalMode === 'table'" class="overflow-x-auto -mx-1">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-default text-left">
							<th
								v-for="column in columns"
								:key="column"
								class="px-3 py-2 font-mono text-xs font-semibold text-dimmed"
							>
								{{ column }}
							</th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="(row, rowIndex) in rows"
							:key="rowIndex"
							class="border-b border-default/60 last:border-0 hover:bg-elevated/40 transition-colors"
						>
							<td
								v-for="(column, colIndex) in columns"
								:key="column"
								class="px-3 py-2 font-mono whitespace-nowrap"
								:class="colIndex === 0 ? 'text-primary' : 'text-toned'"
							>
								{{ renderCell((row as Record<string, unknown>)[column]) }}
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<!-- json -->
			<pre
				v-else-if="internalMode === 'json'"
				class="text-xs rounded-lg border border-default bg-default p-4 overflow-auto max-h-80 whitespace-pre text-toned"
				>{{ jsonText }}</pre
			>

			<!-- chart -->
			<div v-else>
				<DmsChart
					v-if="chartAvailable"
					type="area"
					:static-dataset="chartDataset"
					color="primary"
					height="280px"
					:show-legend="false"
					xaxis-type="category"
				/>
				<div
					v-else
					class="flex flex-col items-center justify-center gap-2 py-16 text-dimmed text-center"
				>
					<UIcon name="i-ph-chart-line" class="text-4xl text-dimmed/60" />
					<p class="text-sm">{{ $t("dms_database.query.chartUnavailable") }}</p>
				</div>
			</div>
		</div>
	</DmsCard>
</template>
