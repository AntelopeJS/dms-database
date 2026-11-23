<script setup lang="ts">
import {
	instanceBadge as badgeOf,
	useDataBrowserTabs,
} from '../build/composables/useDataBrowserTabs'
import { useStagedEdits } from '../build/data/stagedEdits'
import type { BrowserTab } from '../build/composables/useDataBrowserTabs'

const {
	tabs,
	activeId,
	hasMultipleSchemas,
	activateTab,
	closeTab,
	pinTab,
	moveTab,
} = useDataBrowserTabs()
const { t } = useI18n()
const staged = useStagedEdits()
const { confirm } = useConfirm()

const closeButtonClass =
	'rounded p-0.5 text-dimmed opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-elevated hover:text-default'
const pinButtonClass =
	'rounded p-0.5 text-muted hover:bg-elevated hover:text-highlighted'
const hasPreview = computed(() => tabs.value.some((tab) => tab.preview))

function tabAriaLabel(tab: BrowserTab): string {
	return tab.preview
		? t('dms_database.data.tabs.preview', { name: label(tab) })
		: label(tab)
}

async function pinFromButton(tab: BrowserTab, event: MouseEvent) {
	const origin = event.currentTarget
	const tabEl =
		origin instanceof HTMLElement ? origin.closest('[data-tab]') : null
	pinTab(tab.id)
	await nextTick()
	if (document.activeElement === document.body) {
		tabEl?.querySelector('button')?.focus()
	}
}

const draggedId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)

function onDragStart(tab: BrowserTab, event: DragEvent) {
	draggedId.value = tab.id
	event.dataTransfer?.setData('text/plain', tab.id)
	if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(tab: BrowserTab, event: DragEvent) {
	if (!draggedId.value || draggedId.value === tab.id) return
	event.preventDefault()
	if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
	dropTargetId.value = tab.id
}

function onDrop(tab: BrowserTab) {
	if (draggedId.value && draggedId.value !== tab.id) {
		pinTab(draggedId.value)
		moveTab(draggedId.value, tab.id)
	}
	onDragEnd()
}

function onDragEnd() {
	draggedId.value = null
	dropTargetId.value = null
}

const pointerInBar = ref(false)
const showSchema = ref(hasMultipleSchemas.value)
watch(hasMultipleSchemas, (several) => {
	if (several || !pointerInBar.value) showSchema.value = several
})

function leaveBar() {
	pointerInBar.value = false
	showSchema.value = hasMultipleSchemas.value
}

watch(
	() => tabs.value.length === 0,
	(empty) => {
		if (empty) leaveBar()
	},
)

function label(tab: BrowserTab): string {
	return showSchema.value ? `${tab.schema}.${tab.table}` : tab.table
}

function instanceBadge(tab: BrowserTab): string | null {
	return badgeOf(tab.instance, t('dms_database.data.scope.all'))
}

const strip = useTemplateRef<HTMLDivElement>('strip')
watch(
	[activeId, () => tabs.value.length],
	async () => {
		await nextTick()
		const id = activeId.value
		if (!id) return
		const active = [
			...(strip.value?.querySelectorAll<HTMLElement>('[data-tab]') ?? []),
		].find((element) => element.dataset.tabId === id)
		active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
	},
	{ immediate: true, flush: 'post' },
)

async function close(tab: BrowserTab) {
	const pending = staged.count(tab.id)
	if (pending > 0) {
		const discard = await confirm({
			title: t('dms_database.data.tabs.close_title', { table: tab.table }),
			description: t('dms_database.data.tabs.close_description', pending),
			confirmLabel: t('dms_database.data.tabs.close_discard'),
			cancelLabel: t('dms_database.data.tabs.close_keep'),
			color: 'warning',
			initialFocus: 'cancel',
		})
		if (!discard) return
		staged.discard(tab.id)
	}
	closeTab(tab.id)
}
</script>

<template>
	<div
		v-if="tabs.length > 0"
		class="border-default bg-elevated/50 flex items-end border-b"
		@pointerenter="pointerInBar = true"
		@pointerleave="leaveBar"
	>
		<div
			ref="strip"
			class="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto px-2 pt-1.5 [scrollbar-width:thin]"
		>
			<div
				v-for="tab in tabs"
				:key="tab.id"
				data-tab
				:data-tab-id="tab.id"
				draggable="true"
				class="group flex shrink-0 select-none items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1.5"
				:class="[
					tab.id === activeId
						? 'border-default bg-default'
						: 'hover:bg-default/60 border-transparent bg-transparent',
					tab.id === draggedId ? 'opacity-40' : '',
					tab.id === dropTargetId ? 'ring-primary ring-1 ring-inset' : '',
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
						class="text-primary font-mono text-[10.5px]"
					>
						{{ instanceBadge(tab) }}
					</span>
					<span
						v-if="staged.count(tab.id) > 0"
						class="bg-warning size-1.5 rounded-full"
						:title="t('dms_database.data.tabs.unsaved', staged.count(tab.id))"
					/>
				</button>
				<button
					type="button"
					:class="[closeButtonClass, { 'opacity-100': tab.id === activeId }]"
					:aria-label="t('dms_database.data.tabs.close')"
					:title="t('dms_database.data.tabs.close')"
					@click.stop="close(tab)"
				>
					<UIcon name="i-ph-x" class="size-3" />
				</button>
				<UTooltip
					v-if="tab.preview"
					:text="t('dms_database.data.tabs.keep_hint')"
				>
					<button
						type="button"
						:class="pinButtonClass"
						:aria-label="t('dms_database.data.tabs.keep')"
						@click.stop="pinFromButton(tab, $event)"
					>
						<UIcon name="i-ph-push-pin" class="size-3" />
					</button>
				</UTooltip>
			</div>
		</div>
		<span
			v-if="hasPreview"
			class="text-dimmed hidden shrink-0 self-center whitespace-nowrap px-3 pb-1 pt-1.5 text-[11px] lg:inline"
		>
			<i18n-t keypath="dms_database.data.tabs.hint" tag="span" scope="global">
				<template #italic>
					<em>{{ t('dms_database.data.tabs.italic') }}</em>
				</template>
			</i18n-t>
		</span>
	</div>
</template>
