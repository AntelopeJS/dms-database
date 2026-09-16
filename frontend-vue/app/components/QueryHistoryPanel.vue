<script setup lang="ts">
import type { HistoryEntry } from "../composables/useQueryStore";
import { formatRelativeTime } from "../utils/relativeTime";

interface Props {
	items: HistoryEntry[];
	total: number;
	page: number;
	pageSize: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
	"update:page": [value: number];
	load: [entry: HistoryEntry];
	save: [entry: HistoryEntry];
}>();

const totalPages = computed(() =>
	Math.max(1, Math.ceil(props.total / props.pageSize)),
);

const canPrev = computed(() => props.page > 0);
const canNext = computed(() => props.page + 1 < totalPages.value);

const QUERY_PREVIEW_LIMIT = 64;

function preview(query: string): string {
	const flat = query.replace(/\s+/g, " ").trim();
	return flat.length > QUERY_PREVIEW_LIMIT
		? `${flat.slice(0, QUERY_PREVIEW_LIMIT)}…`
		: flat;
}

const { t } = useI18n();

function meta(item: HistoryEntry): string {
	const count = t(
		"dms_database.query.rowCount",
		{ count: item.rowCount },
		item.rowCount,
	);
	return `${formatRelativeTime(item.executedAt)} · ${count}`;
}

function prev() {
	if (canPrev.value) emit("update:page", props.page - 1);
}

function next() {
	if (canNext.value) emit("update:page", props.page + 1);
}
</script>

<template>
	<DmsCard :padded="false" class="flex flex-col">
		<header class="flex items-center gap-2.5 px-4 pt-4 pb-2.5">
			<UIcon name="i-ph-clock" class="text-primary shrink-0" />
			<h3 class="text-highlighted text-sm font-semibold">
				{{ $t("dms_database.query.history") }}
			</h3>
		</header>

		<ul
			v-if="items.length > 0"
			class="flex-1 overflow-y-auto px-1.5 pb-2 space-y-0.5"
		>
			<li
				v-for="item in items"
				:key="item.id"
				class="group flex items-center gap-2.5 rounded-md px-2.5 py-2.5 cursor-pointer hover:bg-elevated transition-colors"
				@click="emit('load', item)"
				@keydown.enter.prevent="emit('load', item)"
			>
				<UIcon
					name="i-ph-clock"
					class="text-dimmed shrink-0 size-3.5"
				/>
				<div class="min-w-0 flex-1">
					<div class="text-toned font-mono text-[11px] truncate">
						{{ preview(item.source) }}
					</div>
					<div class="text-dimmed text-[10px] mt-0.5">
						{{ meta(item) }}
					</div>
				</div>
				<UButton
					icon="i-ph-star"
					variant="ghost"
					color="neutral"
					size="xs"
					class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:text-warning"
					:aria-label="$t('dms_database.query.saveAsFavorite')"
					@click.stop="emit('save', item)"
				/>
			</li>
		</ul>

		<div
			v-else
			class="flex-1 flex items-center justify-center px-4 py-6 text-xs text-dimmed text-center"
		>
			{{ $t("dms_database.query.emptyHistory") }}
		</div>

		<footer
			v-if="items.length > 0"
			class="flex items-center justify-between gap-2 px-3 py-2 border-t border-default"
		>
			<UButton
				size="xs"
				variant="ghost"
				color="neutral"
				icon="i-ph-caret-left"
				:disabled="!canPrev"
				:label="$t('dms_database.query.previous')"
				@click="prev"
			/>
			<span class="text-xs text-dimmed tabular-nums">
				{{ page + 1 }} / {{ totalPages }}
			</span>
			<UButton
				size="xs"
				variant="ghost"
				color="neutral"
				trailing-icon="i-ph-caret-right"
				:disabled="!canNext"
				:label="$t('dms_database.query.next')"
				@click="next"
			/>
		</footer>
	</DmsCard>
</template>
