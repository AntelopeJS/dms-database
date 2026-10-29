<script setup lang="ts">
defineProps<{
	table: string
	total: number
	loading: boolean
}>()

const search = defineModel<string>('search', { required: true })

const emit = defineEmits<{
	reload: []
	openQuery: []
}>()

const { t, n } = useI18n()
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement }>(
	'searchInput',
)

defineExpose({
	focusSearch: () => searchInput.value?.inputRef?.focus(),
})
</script>

<template>
	<div
		class="border-default flex flex-wrap items-center gap-2 border-b px-3 py-2"
	>
		<div class="flex items-baseline gap-2">
			<span class="text-highlighted font-mono text-sm font-semibold">
				{{ table }}
			</span>
			<span class="text-dimmed font-mono text-xs tabular-nums">
				{{ t('dms_database.data.grid.rows', { count: n(total) }, total) }}
			</span>
		</div>
		<UInput
			ref="searchInput"
			v-model="search"
			icon="i-ph-magnifying-glass"
			size="sm"
			class="w-64"
			:placeholder="t('dms_database.data.grid.search')"
		>
			<template #trailing>
				<UKbd value="meta" size="sm" />
				<UKbd value="/" size="sm" />
			</template>
		</UInput>
		<div class="ml-auto flex items-center gap-1.5">
			<UTooltip :text="t('dms_database.data.grid.refresh')">
				<UButton
					icon="i-ph-arrows-clockwise"
					color="neutral"
					variant="ghost"
					size="sm"
					:loading="loading"
					:aria-label="t('dms_database.data.grid.refresh')"
					@click="emit('reload')"
				/>
			</UTooltip>
			<UButton
				icon="i-ph-code"
				color="neutral"
				variant="ghost"
				size="sm"
				:label="t('dms_database.data.grid.open_query')"
				@click="emit('openQuery')"
			/>
		</div>
	</div>
</template>
