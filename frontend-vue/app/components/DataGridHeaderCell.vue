<script setup lang="ts">
import type { ColumnFilterState, GridColumn } from "../composables/useDataBrowserGrid";
import { COLUMN_ROLE_CLASSES, type ColumnRole, describeRuntimeType } from "../utils/fieldTypes";

// A column header (D-14): its type as a neutral icon, colour only for the key
// and relation columns, and the sort arrow and funnel shown whenever they are
// on. The funnel opens the column's filter; the active filters are also chips
// under the toolbar.

const props = defineProps<{
	column: GridColumn;
	role: ColumnRole;
	sortKey: string | null;
	sortDirection: "asc" | "desc";
	filter: ColumnFilterState | null;
	width: number;
}>();

const emit = defineEmits<{
	sort: [];
	filter: [value: ColumnFilterState | null];
	resize: [width: number];
}>();

const { t } = useI18n();

const ROLE_ICONS: Record<ColumnRole, string | null> = {
	key: "i-ph-key",
	relation: "i-ph-arrow-right",
	plain: null,
};

const type = computed(() => describeRuntimeType(props.column.type, props.column.name));
const icon = computed(() => ROLE_ICONS[props.role] ?? type.value.icon);

const sortIcon = computed(() => {
	if (props.sortKey !== props.column.name) return null;
	return props.sortDirection === "asc" ? "i-ph-arrow-up" : "i-ph-arrow-down";
});

// --- filter popover ---
const filterOpen = ref(false);
const draftMode = ref<"is" | "contains">("contains");
const draftValue = ref("");

watch(filterOpen, (open) => {
	if (!open) return;
	draftMode.value = props.filter?.mode ?? "contains";
	draftValue.value = props.filter?.value ?? "";
});

const modeOptions = computed(() => [
	{ label: t("dms_database.data.filters.contains"), value: "contains" },
	{ label: t("dms_database.data.filters.is"), value: "is" },
]);

function applyFilter() {
	const value = draftValue.value.trim();
	emit("filter", value ? { mode: draftMode.value, value } : null);
	filterOpen.value = false;
}

function clearFilter() {
	emit("filter", null);
	filterOpen.value = false;
}

// --- column resize (drag the right edge) ---
const MIN_WIDTH = 80;
const MAX_WIDTH = 640;

// Emits are rAF-throttled (one width update per frame, not per mousemove) and
// the window listeners are detached if the header unmounts mid-drag.
let resizeFrame = 0;
let detachResize: (() => void) | null = null;

function startResize(event: MouseEvent) {
	event.preventDefault();
	const startX = event.clientX;
	const startWidth = props.width;
	function onMove(move: MouseEvent) {
		cancelAnimationFrame(resizeFrame);
		resizeFrame = requestAnimationFrame(() => {
			const next = Math.min(
				MAX_WIDTH,
				Math.max(MIN_WIDTH, startWidth + (move.clientX - startX)),
			);
			emit("resize", next);
		});
	}
	function onUp() {
		detachResize?.();
	}
	detachResize = () => {
		cancelAnimationFrame(resizeFrame);
		window.removeEventListener("mousemove", onMove);
		window.removeEventListener("mouseup", onUp);
		detachResize = null;
	};
	window.addEventListener("mousemove", onMove);
	window.addEventListener("mouseup", onUp);
}

onBeforeUnmount(() => detachResize?.());
</script>

<template>
	<th
		class="group border-default bg-elevated relative border-r border-b p-0 text-left font-medium select-none"
		scope="col"
		:aria-sort="sortIcon ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined"
	>
		<div class="flex items-center gap-1.5 px-2.5 py-1.5">
			<UIcon
				:name="icon"
				class="size-3 shrink-0"
				:class="role === 'plain' ? 'text-dimmed' : COLUMN_ROLE_CLASSES[role]"
				:title="type.label"
			/>
			<button
				type="button"
				class="min-w-0 flex-1 truncate text-left font-mono text-xs hover:text-highlighted"
				:class="role === 'relation' ? 'text-primary' : 'text-toned'"
				:title="t('dms_database.data.grid.sort_hint')"
				@click="emit('sort')"
			>
				{{ column.name }}
			</button>
			<UIcon v-if="sortIcon" :name="sortIcon" class="text-primary size-3 shrink-0" />
			<!-- Columns named after the selection parameters (schema, table,
			     instance) cannot be filtered: the server reads those as the
			     table to browse. -->
			<UPopover v-if="!isReservedFilterField(column.name)" v-model:open="filterOpen">
				<button
					type="button"
					class="rounded p-0.5 transition-opacity"
					:class="
						filter
							? 'text-primary opacity-100'
							: 'text-dimmed opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
					"
					:aria-label="t('dms_database.data.filters.column_title', { column: column.name })"
					:title="t('dms_database.data.filters.column_title', { column: column.name })"
				>
					<UIcon name="i-ph-funnel" class="size-3" />
				</button>
				<template #content>
					<div class="w-60 space-y-2 p-3">
						<p class="text-muted font-mono text-xs">{{ column.name }}</p>
						<USelect v-model="draftMode" :items="modeOptions" size="xs" class="w-full" />
						<UInput
							v-model="draftValue"
							size="xs"
							class="w-full"
							autofocus
							@keydown.enter="applyFilter"
						/>
						<div class="flex justify-end gap-1.5">
							<UButton
								size="xs"
								variant="ghost"
								color="neutral"
								:label="t('dms_database.data.filters.remove')"
								@click="clearFilter"
							/>
							<UButton
								size="xs"
								:label="t('dms_database.data.filters.apply')"
								@click="applyFilter"
							/>
						</div>
					</div>
				</template>
			</UPopover>
		</div>
		<span
			class="hover:bg-primary/40 absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize"
			@mousedown="startResize"
		/>
	</th>
</template>
