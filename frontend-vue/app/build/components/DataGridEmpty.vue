<script setup lang="ts">
import { DATABASE_PAGES } from '../utils/databaseLinks'

defineProps<{
	table: string
	total: number
	loadError: string | null
	loading: boolean
	empty: boolean
	hasRefinements: boolean
	readOnly: boolean
}>()

const emit = defineEmits<{
	reload: []
	clearRefinements: []
	searchAll: []
}>()

const { t, n } = useI18n()
</script>

<template>
	<div v-if="loadError" class="grid h-full place-items-center p-6">
		<DmsEmptyState
			variant="error"
			:title="t('dms_database.data.empty.error_title', { table })"
			:actions="[
				{
					label: t('dms_database.common.retry'),
					icon: 'i-ph-arrows-clockwise',
					color: 'neutral',
					variant: 'outline',
					onClick: () => emit('reload'),
				},
				{
					label: t('dms_database.data.empty.check_connection'),
					color: 'neutral',
					variant: 'ghost',
					to: DATABASE_PAGES.overview,
				},
			]"
		>
			<p class="text-muted text-sm">
				{{ t('dms_database.data.empty.error_description') }}
			</p>
			<p class="text-dimmed mt-1 font-mono text-[11px]">{{ loadError }}</p>
		</DmsEmptyState>
	</div>
	<div
		v-else-if="!loading && empty && hasRefinements"
		class="grid h-full place-items-center p-6"
	>
		<DmsEmptyState
			variant="no-result"
			:title="t('dms_database.data.empty.no_match_title')"
			:description="
				t('dms_database.data.empty.no_match_description', {
					count: n(total),
					table,
				})
			"
			:actions="[
				{
					label: t('dms_database.data.empty.clear_filters'),
					color: 'neutral',
					variant: 'outline',
					onClick: () => emit('clearRefinements'),
				},
				...(readOnly
					? []
					: [
							{
								label: t('dms_database.data.empty.search_all'),
								color: 'neutral' as const,
								variant: 'ghost' as const,
								onClick: () => emit('searchAll'),
							},
						]),
			]"
		/>
	</div>
	<div v-else-if="!loading && empty" class="grid h-full place-items-center p-6">
		<DmsEmptyState
			:title="t('dms_database.data.empty.no_rows_title', { table })"
			:description="t('dms_database.data.empty.no_rows_description')"
		/>
	</div>
</template>
