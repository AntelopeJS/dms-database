<script setup lang="ts">
defineProps<{
	preview: boolean
	movedCount: number
	selectedTable: string | null
	focusId: string | null
	isLarge: boolean
	tableCount: number
}>()

const emit = defineEmits<{
	discardLayout: []
	keepLayout: []
	inspect: [tableName: string]
	toggleFocus: []
}>()

const { t } = useI18n()
</script>

<template>
	<div
		v-if="preview"
		class="diagram-float border-primary/40 mt-12 gap-2 py-1.5 pl-3 pr-1.5 text-sm"
	>
		<UIcon name="i-ph-squares-four" class="text-primary size-4" />
		<span>{{ t('dms_database.diagram.preview.title') }}</span>
		<span class="text-muted mr-1">
			{{ t('dms_database.diagram.preview.moved', movedCount) }}
		</span>
		<UButton
			size="sm"
			color="neutral"
			variant="ghost"
			:label="t('dms_database.diagram.preview.discard')"
			@click="emit('discardLayout')"
		/>
		<UButton
			size="sm"
			icon="i-ph-check"
			:label="t('dms_database.diagram.preview.keep')"
			@click="emit('keepLayout')"
		/>
	</div>
	<div
		v-else-if="selectedTable || focusId"
		class="diagram-float mt-12 gap-1 py-1 pl-3 pr-1 text-sm"
	>
		<UIcon name="i-ph-table" class="text-primary size-4" />
		<span class="font-mono text-[12.5px]">
			{{ selectedTable ?? focusId?.split('::')[1] }}
		</span>
		<span class="diagram-float__sep" />
		<UButton
			v-if="selectedTable"
			size="xs"
			color="neutral"
			variant="ghost"
			icon="i-ph-sidebar-simple"
			:label="t('dms_database.diagram.selection.inspect')"
			@click="emit('inspect', selectedTable)"
		/>
		<UButton
			size="xs"
			color="neutral"
			:variant="focusId ? 'soft' : 'ghost'"
			icon="i-ph-crosshair"
			:label="
				focusId
					? t('dms_database.diagram.selection.show_all')
					: t('dms_database.diagram.selection.focus')
			"
			@click="emit('toggleFocus')"
		/>
	</div>
	<div
		v-else-if="isLarge"
		class="diagram-float text-warning mt-12 gap-2 px-3 py-2 text-sm"
	>
		<UIcon name="i-ph-warning" class="size-4" />
		{{
			t('dms_database.diagram.large', {
				count: tableCount,
			})
		}}
	</div>
</template>

<style scoped src="./diagramFloat.css"></style>
