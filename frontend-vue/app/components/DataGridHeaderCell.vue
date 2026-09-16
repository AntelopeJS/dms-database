<script setup lang="ts">
import type { ColumnFilterState, GridColumn } from "../composables/useDataBrowserGrid";

const props = defineProps<{
	column: GridColumn;
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

// Shared icon set (utils/databaseFieldTypeIcons) so runtime-sampled columns
// carry the same glyph, color and named-field overrides as the inspector.
const typeIcon = computed(() =>
	runtimeTypeIcon(props.column.type, props.column.name),
);

const sortIcon = computed(() => {
	if (props.sortKey !== props.column.name) return null;
	return props.sortDirection === "asc" ? "i-ph-caret-up" : "i-ph-caret-down";
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
	{ label: t("dms_database.data.filterModeContains"), value: "contains" },
	{ label: t("dms_database.data.filterModeIs"), value: "is" },
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
		class="group relative select-none border-r border-b border-default bg-elevated p-0 text-left font-medium"
		scope="col"
	>
		<div class="flex items-center gap-1.5 px-2.5 py-1.5">
			<UIcon
				v-if="column.isPrimaryKey"
				name="i-ph-key"
				class="size-3 shrink-0 text-amber-500"
			/>
			<UIcon
				v-else
				:name="typeIcon.icon"
				class="size-3 shrink-0"
				:class="typeIcon.color"
				:title="typeIcon.label"
			/>
			<button
				type="button"
				class="min-w-0 flex-1 truncate text-left font-mono text-xs text-toned hover:text-highlighted"
				@click="emit('sort')"
			>
				{{ column.name }}
			</button>
			<UIcon v-if="sortIcon" :name="sortIcon" class="size-3 shrink-0 text-primary" />
			<!--
				Data filters on columns named after the wire protocol's selection
				params (schema / table / instance) are silently dropped server-side,
				so don't offer the filter button on those columns at all.
			-->
			<UPopover v-if="!isReservedFilterField(column.name)" v-model:open="filterOpen">
				<button
					type="button"
					class="rounded p-0.5 transition-opacity"
					:class="
						filter
							? 'text-primary opacity-100'
							: 'text-dimmed opacity-0 group-hover:opacity-100'
					"
					:aria-label="t('dms_database.data.filterTitle', { column: column.name })"
				>
					<UIcon name="i-ph-funnel" class="size-3" />
				</button>
				<template #content>
					<div class="w-56 space-y-2 p-3">
						<p class="font-mono text-xs text-muted">{{ column.name }}</p>
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
								:label="t('dms_database.data.filterClear')"
								@click="clearFilter"
							/>
							<UButton
								size="xs"
								:label="t('dms_database.data.filterApply')"
								@click="applyFilter"
							/>
						</div>
					</div>
				</template>
			</UPopover>
		</div>
		<span
			class="absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/40"
			@mousedown="startResize"
		/>
	</th>
</template>
