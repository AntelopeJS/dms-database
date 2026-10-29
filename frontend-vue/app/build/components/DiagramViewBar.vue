<script setup lang="ts">
defineProps<{
	zoomPercent: string
	isEmpty: boolean
}>()

const panMode = defineModel<boolean>('panMode', { required: true })

const emit = defineEmits<{
	zoomOut: []
	resetZoom: []
	zoomIn: []
	fit: []
	addNote: []
}>()

const { t } = useI18n()
</script>

<template>
	<div class="diagram-float">
		<UTooltip :text="t('dms_database.diagram.toolbar.select')" :kbds="['v']">
			<UButton
				size="sm"
				icon="i-ph-cursor"
				:color="panMode ? 'neutral' : 'primary'"
				:variant="panMode ? 'ghost' : 'soft'"
				:aria-pressed="!panMode"
				:aria-label="t('dms_database.diagram.toolbar.select')"
				@click="panMode = false"
			/>
		</UTooltip>
		<UTooltip :text="t('dms_database.diagram.toolbar.pan')" :kbds="['h']">
			<UButton
				size="sm"
				icon="i-ph-hand"
				:color="panMode ? 'primary' : 'neutral'"
				:variant="panMode ? 'soft' : 'ghost'"
				:aria-pressed="panMode"
				:aria-label="t('dms_database.diagram.toolbar.pan')"
				@click="panMode = true"
			/>
		</UTooltip>
		<span class="diagram-float__sep" />
		<UTooltip :text="t('dms_database.diagram.toolbar.zoom_out')">
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-ph-magnifying-glass-minus"
				:aria-label="t('dms_database.diagram.toolbar.zoom_out')"
				@click="emit('zoomOut')"
			/>
		</UTooltip>
		<UTooltip
			:text="t('dms_database.diagram.toolbar.reset_zoom')"
			:kbds="['0']"
		>
			<button
				type="button"
				class="text-muted hover:text-highlighted hover:bg-elevated min-w-12 rounded-md px-2 font-mono text-[11.5px] tabular-nums"
				:aria-label="t('dms_database.diagram.toolbar.reset_zoom')"
				@click="emit('resetZoom')"
			>
				{{ zoomPercent }}
			</button>
		</UTooltip>
		<UTooltip :text="t('dms_database.diagram.toolbar.zoom_in')">
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-ph-magnifying-glass-plus"
				:aria-label="t('dms_database.diagram.toolbar.zoom_in')"
				@click="emit('zoomIn')"
			/>
		</UTooltip>
		<UTooltip :text="t('dms_database.diagram.toolbar.fit')" :kbds="['1']">
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-ph-arrows-out"
				:aria-label="t('dms_database.diagram.toolbar.fit')"
				@click="emit('fit')"
			/>
		</UTooltip>
		<span class="diagram-float__sep" />
		<UTooltip :text="t('dms_database.diagram.toolbar.note_hint')" :kbds="['n']">
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-ph-note-pencil"
				:label="t('dms_database.diagram.toolbar.note')"
				:disabled="isEmpty"
				@click="emit('addNote')"
			/>
		</UTooltip>
	</div>
</template>

<style scoped src="./diagramFloat.css"></style>
