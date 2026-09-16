<script setup lang="ts">
import type { BrowserTab } from "../composables/useDataBrowserTabs";

const {
	tabs,
	activeId,
	hasMultipleSchemas,
	activateTab,
	closeTab,
	pinTab,
	moveTab,
} = useDataBrowserTabs();
const { t } = useI18n();

// Shared by the pin and close buttons — they are a hover-reveal pair on the
// same tab and must render identically.
const tabActionClass =
	"rounded p-0.5 text-dimmed opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-elevated hover:text-default";

// The label doubles as the accessible name; a preview tab announces its
// ephemeral state, which the italic styling alone cannot convey.
function tabAriaLabel(tab: BrowserTab): string {
	return tab.preview
		? t("dms_database.data.previewTab", { name: label(tab) })
		: label(tab);
}

// Pinning from the pin button unmounts the button under focus (v-if), which
// would drop focus to <body> for keyboard users; re-anchor it on the tab's
// label button — but only when focus actually fell to the body, so a mouse
// click doesn't get focus stolen elsewhere.
function pinFromButton(tab: BrowserTab, event: MouseEvent) {
	const tabEl = (event.currentTarget as HTMLElement).closest("[data-tab]");
	pinTab(tab.id);
	nextTick(() => {
		if (document.activeElement === document.body) {
			tabEl?.querySelector("button")?.focus();
		}
	});
}

// --- drag & drop reorder ---
const draggedId = ref<string | null>(null);
const dropTargetId = ref<string | null>(null);

function onDragStart(tab: BrowserTab, event: DragEvent) {
	draggedId.value = tab.id;
	// Firefox refuses to start a drag without data attached.
	event.dataTransfer?.setData("text/plain", tab.id);
	if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onDragOver(tab: BrowserTab, event: DragEvent) {
	if (!draggedId.value || draggedId.value === tab.id) return;
	// preventDefault marks the tab as a valid drop target.
	event.preventDefault();
	if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
	dropTargetId.value = tab.id;
}

function onDrop(tab: BrowserTab) {
	// A self-drop is not a reorder: no pin, no move. (onDragOver never marks
	// the dragged tab as a valid target, so this is belt-and-braces.)
	if (draggedId.value && draggedId.value !== tab.id) {
		// An arranged tab is kept (VS Code): a completed drag-reorder pins.
		pinTab(draggedId.value);
		moveTab(draggedId.value, tab.id);
	}
	onDragEnd();
}

function onDragEnd() {
	draggedId.value = null;
	dropTargetId.value = null;
}

function label(tab: BrowserTab): string {
	return hasMultipleSchemas.value ? `${tab.schema}.${tab.table}` : tab.table;
}

function instanceBadge(tab: BrowserTab): string | null {
	if (tab.instance === DEFAULT_INSTANCE_VALUE) return null;
	if (tab.instance === CROSS_INSTANCE_VALUE) return "*";
	return `@${tab.instance}`;
}

function close(tab: BrowserTab) {
	closeTab(tab.id);
}
</script>

<template>
	<div
		v-if="tabs.length > 0"
		class="flex items-end gap-1 overflow-x-auto border-b border-default bg-elevated/50 px-2 pt-1.5"
	>
		<div
			v-for="tab in tabs"
			:key="tab.id"
			data-tab
			draggable="true"
			class="group flex shrink-0 select-none items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1.5"
			:class="[
				tab.id === activeId
					? 'border-default bg-default'
					: 'border-transparent bg-transparent hover:bg-default/60',
				tab.id === draggedId ? 'opacity-40' : '',
				tab.id === dropTargetId ? 'ring-1 ring-primary ring-inset' : '',
			]"
			@dragstart="onDragStart(tab, $event)"
			@dragover="onDragOver(tab, $event)"
			@drop.prevent="onDrop(tab)"
			@dragend="onDragEnd"
		>
			<button
				type="button"
				class="flex items-center gap-1.5"
				:aria-label="tabAriaLabel(tab)"
				@click="activateTab(tab.id)"
				@dblclick="pinTab(tab.id)"
			>
				<UIcon
					name="i-ph-table"
					class="size-3.5"
					:class="tab.id === activeId ? 'text-primary' : 'text-dimmed'"
				/>
				<span
					class="max-w-48 truncate font-mono text-xs"
					:class="[
						tab.id === activeId ? 'text-highlighted' : 'text-muted',
						tab.preview ? 'italic' : '',
					]"
				>
					{{ label(tab) }}
				</span>
				<span
					v-if="instanceBadge(tab)"
					class="rounded bg-primary/10 px-1 font-mono text-[10px] text-primary"
				>
					{{ instanceBadge(tab) }}
				</span>
			</button>
			<button
				type="button"
				:class="[tabActionClass, { 'opacity-100': tab.id === activeId }]"
				:aria-label="$t('dms_database.data.closeTab')"
				@click.stop="close(tab)"
			>
				<UIcon name="i-ph-x" class="size-3" />
			</button>
			<!-- The pin button sits AFTER the close button: pinning unmounts it, and
			     nothing may reflow into the pointer's position — a double-click's
			     second click would otherwise land on the close button and destroy
			     the tab the user just pinned. -->
			<button
				v-if="tab.preview"
				type="button"
				:class="[tabActionClass, { 'opacity-100': tab.id === activeId }]"
				:aria-label="$t('dms_database.data.keepTab')"
				@click.stop="pinFromButton(tab, $event)"
			>
				<UIcon name="i-ph-push-pin" class="size-3" />
			</button>
		</div>
	</div>
</template>
