<script setup lang="ts">
const SEARCH_HINT_ID = 'diagram-search-hint'

defineProps<{
	schemaId: string | null
	schemaItems: { label: string; value: string; icon: string }[]
	searchMissed: boolean
	searchPosition: string | null
}>()

const search = defineModel<string>('search', { required: true })

const emit = defineEmits<{
	openSchema: [id: string]
	runSearch: []
	leaveSearch: []
}>()

const { t } = useI18n()
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement }>(
	'searchInput',
)

defineExpose({
	focus: () => searchInput.value?.inputRef?.focus(),
	blur: () => searchInput.value?.inputRef?.blur(),
})
</script>

<template>
	<div class="flex flex-col items-start gap-1.5">
		<div class="diagram-float">
			<USelect
				:model-value="schemaId ?? undefined"
				:items="schemaItems"
				icon="i-ph-stack"
				variant="ghost"
				size="sm"
				class="min-w-36 font-mono"
				:aria-label="t('dms_database.diagram.schema')"
				@update:model-value="emit('openSchema', String($event))"
			/>
			<span class="diagram-float__sep" />
			<UInput
				ref="searchInput"
				v-model="search"
				icon="i-ph-magnifying-glass"
				variant="ghost"
				size="sm"
				class="w-40 md:w-64"
				:color="searchMissed ? 'error' : 'primary'"
				:highlight="searchMissed"
				:placeholder="t('dms_database.diagram.search')"
				:aria-label="t('dms_database.diagram.search')"
				:aria-invalid="searchMissed || undefined"
				:aria-describedby="searchMissed ? SEARCH_HINT_ID : undefined"
				@keydown.enter.prevent="emit('runSearch')"
				@keydown.escape.prevent="emit('leaveSearch')"
			>
				<template #trailing>
					<span
						v-if="searchPosition"
						class="text-dimmed font-mono text-[11px] tabular-nums"
					>
						{{ searchPosition }}
					</span>
					<UKbd value="F" size="sm" />
				</template>
			</UInput>
		</div>
		<p
			v-if="searchMissed"
			:id="SEARCH_HINT_ID"
			role="status"
			class="diagram-float text-error px-3 py-1 text-xs"
		>
			{{ t('dms_database.diagram.search_empty') }}
		</p>
	</div>
</template>

<style scoped src="./diagramFloat.css"></style>
