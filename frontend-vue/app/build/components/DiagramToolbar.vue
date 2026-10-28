<script setup lang="ts">
import type { SaveStatus } from '../diagram/autosave'

defineProps<{
	saveState: SaveStatus
	savedLabel: string
	canUndo: boolean
	canRedo: boolean
	autoLayoutDisabled: boolean
}>()

const emit = defineEmits<{
	saveNow: []
	undo: []
	redo: []
	autoLayout: []
}>()

const { t } = useI18n()
</script>

<template>
	<div class="diagram-float">
		<span
			class="flex items-center gap-1.5 px-2 font-mono text-[11.5px]"
			:class="saveState === 'error' ? 'text-error' : 'text-dimmed'"
			:title="savedLabel"
			role="status"
		>
			<UIcon
				:name="
					saveState === 'error'
						? 'i-ph-warning-circle'
						: saveState === 'saving'
							? 'i-ph-circle-notch'
							: 'i-ph-check-circle'
				"
				class="size-3.5"
				:class="[
					saveState === 'saving' ? 'animate-spin' : '',
					saveState === 'error' ? '' : 'text-success',
				]"
			/>
			<span class="sr-only md:not-sr-only">{{ savedLabel }}</span>
		</span>
		<UButton
			v-if="saveState === 'error'"
			size="xs"
			color="error"
			variant="soft"
			:label="t('dms_database.common.retry')"
			@click="emit('saveNow')"
		/>
		<span class="diagram-float__sep" />
		<UTooltip
			:text="t('dms_database.diagram.toolbar.undo')"
			:kbds="['meta', 'z']"
		>
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-ph-arrow-counter-clockwise"
				:aria-label="t('dms_database.diagram.toolbar.undo')"
				:disabled="!canUndo"
				@click="emit('undo')"
			/>
		</UTooltip>
		<UTooltip
			:text="t('dms_database.diagram.toolbar.redo')"
			:kbds="['meta', 'shift', 'z']"
		>
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-ph-arrow-clockwise"
				:aria-label="t('dms_database.diagram.toolbar.redo')"
				:disabled="!canRedo"
				@click="emit('redo')"
			/>
		</UTooltip>
		<span class="diagram-float__sep" />
		<UTooltip :text="t('dms_database.diagram.toolbar.auto_layout_hint')">
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-ph-squares-four"
				:aria-label="t('dms_database.diagram.toolbar.auto_layout')"
				:disabled="autoLayoutDisabled"
				@click="emit('autoLayout')"
			>
				<span class="hidden md:inline">
					{{ t('dms_database.diagram.toolbar.auto_layout') }}
				</span>
			</UButton>
		</UTooltip>
	</div>
</template>

<style scoped src="./diagramFloat.css"></style>
