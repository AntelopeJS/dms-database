<script setup lang="ts">
import type { HistoryEntry } from "../../composables/useQueryStore";
import { buildReadonlyColumns } from "../../utils/dmsTableView";

const SCHEMAS_PATH = "/modules/database/schemas";
const DATA_PATH = "/modules/database/data";
const QUERY_PATH = "/modules/database/query";
const TABLES_LOCATION = "/api/database/tables";
const COMPONENT_ID = "database-overview-tables";
const PAGE_ID = "database.overview";
const RECENT_HISTORY_LIMIT = 6;
const STORAGE_TOP_N = 5;
// A recent query slower than this (ms) is flagged with a "warning" tone.
const SLOW_QUERY_MS = 100;

const router = useDmsRouter();

const { t } = useI18n();
const { $authFetch } = useAuthFetch();
const { health } = useDatabaseHealth();

const fullFormatter = new Intl.NumberFormat("en-US");

// --- health hero metrics (driver / latency / pool / collections) ---
const heroMetrics = computed(() => {
	const h = health.value;
	const dash = "—";
	return [
		{ label: t("dms_database.overview.health.driver"), value: h.driver ?? dash },
		{
			label: t("dms_database.overview.health.latency"),
			value: h.latencyMs == null ? dash : String(h.latencyMs),
			unit: h.latencyMs == null ? undefined : "ms",
		},
		{ label: t("dms_database.overview.health.pool"), value: h.pool ?? dash },
		{
			label: t("dms_database.overview.health.collections"),
			value: h.collections,
		},
	];
});

// Beta banner body: the reference design bolds a few key phrases. The i18n
// string marks them with **…** (per-locale, so each translation owns its own
// emphasis); we split on those markers into normal/bold segments — no v-html.
const betaSegments = computed(() =>
	t("dms_database.overview.beta.body")
		.split(/\*\*(.+?)\*\*/g)
		.map((text, index) => ({ text, bold: index % 2 === 1 })),
);

const heroStatus = computed<"ok" | "down">(() =>
	health.value.status === "ok" ? "ok" : "down",
);
const heroValue = computed(() =>
	heroStatus.value === "ok"
		? t("dms_database.overview.health.healthy")
		: t("dms_database.overview.health.down"),
);

// --- stat cards (Schemas / Tables / Total rows / Indexes) ---
const statCards = computed(() => {
	const h = health.value;
	return [
		{
			label: t("dms_database.overview.kpis.schemas"),
			value: h.schemaCount,
			format: "compact" as const,
			icon: "i-ph-stack",
		},
		{
			label: t("dms_database.overview.kpis.tables"),
			value: h.tableCount,
			format: "compact" as const,
			icon: "i-ph-table",
		},
		{
			label: t("dms_database.overview.kpis.rows"),
			value: h.totalRows,
			icon: "i-ph-database",
		},
		{
			// Byte-size storage is not exposed by interface-database. Rather than
			// duplicate the row count under a "Size" label, the fourth KPI surfaces
			// the total declared index count — a real, distinct schema statistic.
			label: t("dms_database.overview.kpis.indexes"),
			value: h.indexCount,
			icon: "i-ph-key",
		},
	];
});

// --- storage by table (row counts as a proxy; byte size unavailable) ---
const storageBars = computed(() => {
	const top = health.value.storage.slice(0, STORAGE_TOP_N);
	const max = top.reduce((m, s) => Math.max(m, s.rows), 0) || 1;
	const COLORS = [
		"bg-primary",
		"bg-info",
		"bg-success",
		"bg-warning",
		"bg-dimmed",
	];
	return top.map((s, idx) => ({
		key: `${s.schema}::${s.table}`,
		table: s.table,
		rows: s.rows,
		rowsLabel: fullFormatter.format(s.rows),
		pct: Math.max(2, Math.round((s.rows / max) * 100)),
		color: COLORS[idx] ?? "bg-dimmed",
	}));
});

// --- recent queries (from query history) ---
const recentQueries = ref<HistoryEntry[]>([]);
const recentLoading = ref(true);

async function loadRecent() {
	recentLoading.value = true;
	try {
		const res = await $authFetch<{ items: HistoryEntry[] }>(
			"/api/database/query/history",
			{ query: { limit: RECENT_HISTORY_LIMIT, offset: 0 } },
		);
		recentQueries.value = res.items ?? [];
	} catch {
		recentQueries.value = [];
	} finally {
		recentLoading.value = false;
	}
}

function recentTone(entry: HistoryEntry): "success" | "warning" {
	return entry.durationMs > SLOW_QUERY_MS ? "warning" : "success";
}

// --- tables panel (shared DmsTableView, read-only) ---
// One table summary row as returned by /api/database/tables/list.
interface TableListRow {
	id: string;
	schema: string;
	name: string;
}

const tableColumns = computed(() =>
	buildReadonlyColumns([
		{ key: "name", header: t("dms_database.overview.tables.cols.table") },
		{ key: "elementCount", header: t("dms_database.overview.tables.cols.rows") },
		{ key: "columnCount", header: t("dms_database.overview.tables.cols.columns") },
		{ key: "indexCount", header: t("dms_database.overview.tables.cols.indexes") },
	]),
);

function openTableData(row: TableListRow) {
	router.push(
		`${DATA_PATH}?schema=${encodeURIComponent(row.schema)}&table=${encodeURIComponent(row.name)}`,
	);
}

// A row double-click navigates to that table in the data browser.
useTableViewRowClick<TableListRow>(COMPONENT_ID, openTableData);

onMounted(loadRecent);
</script>

<template>
	<div class="space-y-5 pb-6">
		<DmsBanner
			color="warning"
			icon="i-ph-info"
			:title="$t('dms_database.overview.beta.title')"
			class="mt-6"
		>
			<template #description>
				<span>
					<template v-for="(seg, i) in betaSegments" :key="i"
						><strong v-if="seg.bold" class="font-semibold text-toned">{{
							seg.text
						}}</strong
						><template v-else>{{ seg.text }}</template></template
					>
				</span>
			</template>
		</DmsBanner>

		<section class="flex flex-wrap items-center gap-4 pb-2">
			<div
				class="rounded-lg bg-primary/10 shadow-sm shrink-0 ring ring-primary/20 flex items-center justify-center size-12"
			>
				<UIcon name="i-ph-gauge" class="text-primary" size="1.75rem" />
			</div>
			<div class="flex-1 min-w-0">
				<h1 class="text-highlighted font-semibold">
					{{ $t("dms_database.overview.title") }}
				</h1>
				<p class="text-muted text-sm">
					{{ $t("dms_database.overview.description") }}
				</p>
			</div>
			<div class="flex flex-wrap gap-2 ml-auto">
				<UButton
					:to="SCHEMAS_PATH"
					color="neutral"
					variant="outline"
					icon="i-ph-stack"
					:label="$t('dms_database.overview.actions.schema')"
				/>
				<UButton
					:to="DATA_PATH"
					color="primary"
					icon="i-ph-table"
					:label="$t('dms_database.overview.actions.openData')"
				/>
			</div>
		</section>

		<DmsStatusSummary
			:status="heroStatus"
			:status-value="heroValue"
			:status-label="$t('dms_database.overview.health.connection')"
			:metrics="heroMetrics"
		/>

		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
			<DmsKpiCard
				v-for="card in statCards"
				:key="card.label"
				variant="stat"
				:title="card.label"
				:icon="card.icon"
				:static-value="card.value"
				value-format="compact"
				:show-delta="false"
				page-id="database.overview"
				:component-id="`overview-kpi-${card.label}`"
			/>
		</div>

		<div class="grid grid-cols-1 gap-5 lg:grid-cols-2 items-stretch">
			<!-- Storage by table -->
			<DmsCard :padded="false" class="flex flex-col">
				<div
					class="flex items-center justify-between gap-3 border-b border-default px-5 py-4 sm:px-6"
				>
					<div class="min-w-0">
						<h2 class="text-highlighted font-semibold leading-tight">
							{{ $t("dms_database.overview.storage.title") }}
						</h2>
						<p class="text-dimmed mt-0.5 text-xs">
							{{ $t("dms_database.overview.storage.subtitle") }}
						</p>
					</div>
					<UButton
						:to="SCHEMAS_PATH"
						variant="link"
						color="primary"
						size="sm"
						trailing-icon="i-ph-arrow-up-right"
						:label="$t('dms_database.overview.storage.viewSchema')"
						class="font-mono"
					/>
				</div>
				<div class="flex-1 px-5 py-4 sm:px-6">
					<div
						v-if="storageBars.length === 0"
						class="text-dimmed py-6 text-center text-sm"
					>
						{{ $t("dms_database.overview.storage.empty") }}
					</div>
					<div v-for="bar in storageBars" :key="bar.key" class="mb-3.5 last:mb-0">
						<div class="mb-1.5 flex items-center justify-between gap-2">
							<span class="text-toned font-mono text-[12.5px] truncate">
								{{ bar.table }}
							</span>
							<span class="text-dimmed font-mono text-xs tabular-nums">
								{{ bar.rowsLabel }}
								{{ $t("dms_database.overview.storage.rowsUnit") }}
							</span>
						</div>
						<div class="h-[9px] w-full overflow-hidden rounded-full bg-elevated">
							<span
								class="block h-full rounded-full"
								:class="bar.color"
								:style="{ width: `${bar.pct}%` }"
							/>
						</div>
					</div>
				</div>
			</DmsCard>

			<!-- Recent queries -->
			<DmsCard :padded="false" class="flex flex-col">
				<div
					class="flex items-center justify-between gap-3 border-b border-default px-5 py-4 sm:px-6"
				>
					<h2 class="text-highlighted font-semibold leading-tight">
						{{ $t("dms_database.overview.recent.title") }}
					</h2>
					<UButton
						:to="QUERY_PATH"
						variant="link"
						color="primary"
						size="sm"
						trailing-icon="i-ph-arrow-up-right"
						:label="$t('dms_database.overview.recent.console')"
						class="font-mono"
					/>
				</div>
				<div class="flex-1 divide-y divide-default">
					<div
						v-if="recentLoading"
						class="text-dimmed px-5 py-6 text-center text-sm"
					>
						<UProgress size="sm" />
					</div>
					<div
						v-else-if="recentQueries.length === 0"
						class="text-dimmed px-5 py-6 text-center text-sm"
					>
						{{ $t("dms_database.overview.recent.empty") }}
					</div>
					<!-- A row links to the query console with the query prefilled
					     (the console reads ?source= once on mount). -->
					<NuxtLink
						v-for="entry in recentQueries"
						v-else
						:key="entry.id"
						:to="{ path: QUERY_PATH, query: { source: entry.source } }"
						class="block"
					>
						<DmsActivityItem
							icon="i-ph-code"
							:icon-color="recentTone(entry)"
							mono
							:title="entry.source"
							:trailing="`${entry.durationMs} ms · ${entry.rowCount} ${$t('dms_database.overview.recent.rowsUnit')}`"
						/>
					</NuxtLink>
				</div>
			</DmsCard>
		</div>

		<!-- Tables panel (shared DmsTableView; double-click a row to open it in the
		     data browser) -->
		<div class="space-y-2">
			<div class="px-1">
				<h2 class="text-highlighted font-semibold leading-tight">
					{{ $t("dms_database.overview.tables.title") }}
				</h2>
				<p class="text-dimmed mt-0.5 text-xs">
					{{ $t("dms_database.overview.tables.subtitle") }}
				</p>
			</div>
			<DmsTableView
				:location="TABLES_LOCATION"
				:columns="tableColumns"
				:form-components="{}"
				:form-container="{ type: 'drawer' }"
				:row-actions="{ details: true }"
				:default-sort="{ field: 'elementCount', desc: true }"
				:component-id="COMPONENT_ID"
				:page-id="PAGE_ID"
				row-id-key="id"
			/>
		</div>
	</div>
</template>
