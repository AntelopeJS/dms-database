<script setup lang="ts">
import { useIntervalFn, useNow } from "@vueuse/core";

// The overview's health hero: whether the database answers, how fast, and
// what it holds. The probe runs again every PROBE_INTERVAL_MS while the page
// is open, so a lost connection shows up without a reload.
const PROBE_INTERVAL_MS = 30_000;
const SECOND_MS = 1000;
const MINUTE_S = 60;

const { t, n, locale } = useI18n();
const { health, isLoading, error, refresh } = useDatabaseHealth();
const now = useNow({ interval: SECOND_MS });

useIntervalFn(() => refresh(), PROBE_INTERVAL_MS);

// A failed health request is a lost connection too: the route answers
// whenever the backend is up.
const isDown = computed(
	() => Boolean(error.value) || health.value.status === "down",
);

const checkedAgo = computed(() => {
	const checkedAt = health.value.checkedAt;
	if (!checkedAt) return "";
	const seconds = Math.max(
		0,
		Math.round((now.value.getTime() - new Date(checkedAt).getTime()) / SECOND_MS),
	);
	return seconds < MINUTE_S
		? t("dms_database.overview.connection.checked_seconds", { count: seconds })
		: t("dms_database.overview.connection.checked_minutes", {
				count: Math.round(seconds / MINUTE_S),
			});
});

const since = computed(() => {
	const parts = [health.value.driver, checkedAgo.value].filter(Boolean);
	return parts.join(" · ");
});

function compact(value: number): string {
	return new Intl.NumberFormat(locale.value, {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
}

const healthyMetrics = computed(() => {
	const h = health.value;
	return [
		{
			label: t("dms_database.overview.connection.latency"),
			value: h.latencyMs ?? "—",
			unit: h.latencyMs === null ? undefined : "ms",
			sub: t("dms_database.overview.connection.latency_sub"),
			tone: "success" as const,
		},
		{
			label: t("dms_database.overview.connection.tables"),
			value: n(h.tableCount),
			sub: t("dms_database.overview.connection.tables_sub", h.schemaCount),
		},
		{
			label: t("dms_database.overview.connection.rows"),
			value: compact(h.totalRows),
			sub: t("dms_database.overview.connection.rows_sub", h.relationCount),
		},
		{
			label: t("dms_database.overview.connection.indexes"),
			value: n(h.indexCount),
			sub: t("dms_database.overview.connection.indexes_sub"),
		},
	];
});

const downMetrics = computed(() => [
	{
		label: t("dms_database.overview.connection.last_error"),
		value: health.value.error ?? t("dms_database.overview.connection.no_answer"),
		tone: "error" as const,
	},
	{
		label: t("dms_database.overview.connection.next_probe"),
		value: Math.round(PROBE_INTERVAL_MS / SECOND_MS),
		unit: "s",
		sub: t("dms_database.overview.connection.next_probe_sub"),
	},
]);
</script>

<template>
	<div class="grid gap-2">
		<DmsStatusSummary
			:status="isDown ? 'down' : 'ok'"
			:status-label="t('dms_database.overview.connection.label')"
			:status-value="
				isDown
					? t('dms_database.overview.connection.down')
					: t('dms_database.overview.connection.healthy')
			"
			:since="since"
			:metrics="isDown ? downMetrics : healthyMetrics"
			:class="isLoading && !health.checkedAt ? 'animate-pulse' : undefined"
		/>
		<div v-if="isDown" class="flex justify-end">
			<UButton
				color="neutral"
				variant="outline"
				size="sm"
				icon="i-ph-arrows-clockwise"
				:loading="isLoading"
				:label="t('dms_database.overview.connection.retry')"
				@click="refresh()"
			/>
		</div>
	</div>
</template>
