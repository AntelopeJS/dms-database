<script setup lang="ts">
import {
	dayLabel,
	groupByDay,
	RUN_DOT_CLASSES,
	runKind,
} from "../build/query/runs";
import type { HistoryEntry, SavedQuery } from "../composables/useQueryStore";

// The query library (D-11): one rail for the runs of the caller (History),
// the queries they saved (Saved) and the ones teammates shared (Team), with
// one search over all three. Runs are grouped by day and carry a dot telling
// a fast, slow, failed or writing run apart.

type LibraryTab = "history" | "saved" | "team";

const props = defineProps<{
	history: HistoryEntry[];
	saved: SavedQuery[];
	team: SavedQuery[];
	/** The saved query open in the editor. */
	activeSavedId: string | null;
	activeHistoryId: string | null;
	loading: boolean;
}>();

const emit = defineEmits<{
	"open-history": [entry: HistoryEntry];
	"save-history": [entry: HistoryEntry];
	"open-saved": [query: SavedQuery];
	"edit-saved": [query: SavedQuery];
	"delete-saved": [query: SavedQuery];
	"clear-history": [];
}>();

const { t, n, locale } = useI18n();

const tab = ref<LibraryTab>("history");
const search = ref("");

const tabs = computed(() => [
	{ value: "history", label: t("dms_database.query.library.history") },
	{ value: "saved", label: t("dms_database.query.library.saved"), badge: props.saved.length },
	{ value: "team", label: t("dms_database.query.library.team"), badge: props.team.length },
]);

function matches(...texts: (string | undefined)[]): boolean {
	const needle = search.value.trim().toLowerCase();
	return !needle || texts.some((text) => text?.toLowerCase().includes(needle));
}

const historyGroups = computed(() =>
	groupByDay(
		props.history.filter((entry) => matches(entry.source, entry.error)),
		(entry) => entry.executedAt,
	).map((group) => ({
		...group,
		label: dayLabel(group.date, locale.value, {
			today: t("dms_database.query.library.today"),
			yesterday: t("dms_database.query.library.yesterday"),
		}),
	})),
);

const savedItems = computed(() =>
	(tab.value === "team" ? props.team : props.saved).filter((query) =>
		matches(query.name, query.description, query.source, query.ownerName),
	),
);

function time(iso: string): string {
	return new Intl.DateTimeFormat(locale.value, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function runMeta(entry: HistoryEntry): string {
	if (entry.status === "error") return entry.error ?? t("dms_database.query.library.failed");
	const outcome = entry.mutation
		? t("dms_database.query.library.changed", { count: n(entry.rowCount) }, entry.rowCount)
		: t("dms_database.query.library.rows", { count: n(entry.rowCount) }, entry.rowCount);
	return `${time(entry.executedAt)} · ${entry.durationMs} ms · ${outcome}`;
}

function savedMeta(query: SavedQuery): string {
	const date = new Intl.DateTimeFormat(locale.value, { day: "numeric", month: "short" }).format(
		new Date(query.updatedAt ?? query.createdAt),
	);
	return query.ownerName ? `${query.ownerName} · ${date}` : date;
}

function initials(name?: string): string {
	return (name ?? "?")
		.split(/\s+/)
		.map((part) => part[0] ?? "")
		.join("")
		.slice(0, 2)
		.toUpperCase();
}
</script>

<template>
	<DmsCard :padded="false" class="flex min-h-0 flex-col overflow-hidden">
		<div class="border-default border-b px-3 pt-2">
			<UTabs v-model="tab" :items="tabs" variant="link" size="sm" :content="false" />
		</div>
		<div class="p-3 pb-2">
			<UInput
				v-model="search"
				icon="i-ph-magnifying-glass"
				size="sm"
				class="w-full"
				:placeholder="t('dms_database.query.library.search')"
			/>
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
			<template v-if="tab === 'history'">
				<section v-for="group in historyGroups" :key="group.key" class="mb-2">
					<DmsEyebrow :label="group.label" class="px-2 pt-2 pb-1" />
					<div
						v-for="entry in group.items"
						:key="entry.id"
						class="group/run focus-within:bg-elevated hover:bg-elevated relative grid cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-x-2 rounded-md px-2 py-1.5"
						:class="entry.id === activeHistoryId ? 'bg-primary/10' : ''"
						role="button"
						tabindex="0"
						@click="emit('open-history', entry)"
						@keydown.enter="emit('open-history', entry)"
					>
						<span class="mt-1.5 size-2 rounded-full" :class="RUN_DOT_CLASSES[runKind(entry)]" />
						<span class="text-toned truncate font-mono text-[12px]" :title="entry.source">{{ entry.source }}</span>
						<UButton
							icon="i-ph-star"
							color="neutral"
							variant="ghost"
							size="xs"
							class="opacity-0 group-focus-within/run:opacity-100 group-hover/run:opacity-100"
							:aria-label="t('dms_database.query.library.save')"
							:title="t('dms_database.query.library.save')"
							@click.stop="emit('save-history', entry)"
						/>
						<span
							class="col-start-2 truncate text-[11px]"
							:class="entry.status === 'error' ? 'text-error' : 'text-dimmed'"
						>
							{{ runMeta(entry) }}
						</span>
					</div>
				</section>
				<DmsEmptyState
					v-if="historyGroups.length === 0 && !loading"
					size="sm"
					icon="i-ph-clock-counter-clockwise"
					:title="search ? t('dms_database.query.library.no_match') : t('dms_database.query.library.history_empty')"
				/>
			</template>

			<template v-else>
				<div
					v-for="query in savedItems"
					:key="query.id"
					class="group/saved hover:bg-elevated focus-within:bg-elevated grid cursor-pointer gap-0.5 rounded-md px-2 py-2"
					:class="query.id === activeSavedId ? 'bg-primary/10' : ''"
					role="button"
					tabindex="0"
					@click="emit('open-saved', query)"
					@keydown.enter="emit('open-saved', query)"
				>
					<div class="flex items-center gap-2">
						<span class="text-highlighted truncate text-[13px] font-medium">{{ query.name }}</span>
						<UBadge v-if="query.shared && tab === 'saved'" color="neutral" variant="outline" size="sm">
							{{ t("dms_database.query.library.shared") }}
						</UBadge>
						<span v-if="tab === 'saved'" class="ml-auto flex opacity-0 group-focus-within/saved:opacity-100 group-hover/saved:opacity-100">
							<UButton
								icon="i-ph-pencil-simple"
								color="neutral"
								variant="ghost"
								size="xs"
								:aria-label="t('dms_database.query.library.edit')"
								:title="t('dms_database.query.library.edit')"
								@click.stop="emit('edit-saved', query)"
							/>
							<UButton
								icon="i-ph-trash"
								color="error"
								variant="ghost"
								size="xs"
								:aria-label="t('dms_database.query.library.delete')"
								:title="t('dms_database.query.library.delete')"
								@click.stop="emit('delete-saved', query)"
							/>
						</span>
					</div>
					<p v-if="query.description" class="text-muted line-clamp-2 text-xs">{{ query.description }}</p>
					<span class="text-dimmed flex items-center gap-1.5 text-[11px]">
						<UAvatar v-if="tab === 'team'" :text="initials(query.ownerName)" size="3xs" />
						{{ savedMeta(query) }}
					</span>
				</div>
				<DmsEmptyState
					v-if="savedItems.length === 0 && !loading"
					size="sm"
					icon="i-ph-star"
					:title="
						search
							? t('dms_database.query.library.no_match')
							: tab === 'team'
								? t('dms_database.query.library.team_empty')
								: t('dms_database.query.library.saved_empty')
					"
				/>
			</template>
		</div>

		<footer
			v-if="tab === 'history'"
			class="border-default text-dimmed flex items-center gap-2 border-t px-3 py-2 text-[11.5px]"
		>
			{{ t("dms_database.query.library.history_kept") }}
			<UButton
				class="ml-auto"
				size="xs"
				color="neutral"
				variant="ghost"
				:disabled="history.length === 0"
				:label="t('dms_database.query.library.clear')"
				@click="emit('clear-history')"
			/>
		</footer>
	</DmsCard>
</template>
