<script setup lang="ts">
import { DEFAULT_INSTANCE_VALUE } from '../composables/useDataBrowserTabs'

defineProps<{
	table: string
	instances: string[]
}>()

const emit = defineEmits<{
	switchInstance: [instance: string]
}>()

const { t } = useI18n()
</script>

<template>
	<div
		class="border-default bg-warning/5 flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm"
	>
		<UIcon name="i-ph-lock-simple" class="text-warning size-4" />
		<span>
			<b>{{ t('dms_database.data.grid.read_only') }}</b>
			<span class="text-muted ml-1">
				{{ t('dms_database.data.grid.read_only_detail', { table }) }}
			</span>
		</span>
		<span class="ml-auto flex gap-1.5">
			<UButton
				v-for="instance in instances"
				:key="instance"
				size="xs"
				color="neutral"
				variant="outline"
				:label="t('dms_database.data.grid.switch_to', { instance })"
				@click="emit('switchInstance', instance)"
			/>
			<UButton
				size="xs"
				color="neutral"
				variant="outline"
				:label="
					t('dms_database.data.grid.switch_to', {
						instance: t('dms_database.data.scope.default'),
					})
				"
				@click="emit('switchInstance', DEFAULT_INSTANCE_VALUE)"
			/>
		</span>
	</div>
</template>
