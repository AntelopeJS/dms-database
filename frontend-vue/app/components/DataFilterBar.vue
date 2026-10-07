<script setup lang="ts">
import { isReservedFilterField } from '../build/composables/useDataBrowserGrid'
import type {
	ColumnFilterState,
	GridColumn,
} from '../build/composables/useDataBrowserGrid'
import { describeRuntimeType } from '../build/utils/fieldTypes'

// The active column filters as removable chips (D-14), with a way to add one
// on any column and to clear them all.

type FilterMode = ColumnFilterState['mode']

const props = defineProps<{
	columns: GridColumn[]
	filters: Record<string, ColumnFilterState>
}>()

const emit = defineEmits<{
	set: [field: string, filter: ColumnFilterState | null]
	clear: []
}>()

const { t } = useI18n()

const chips = computed(() =>
	Object.entries(props.filters)
		.filter(([, filter]) => filter.value)
		.map(([field, filter]) => {
			const column = props.columns.find((candidate) => candidate.name === field)
			return {
				field,
				filter,
				icon: column
					? describeRuntimeType(column.type, column.name).icon
					: 'i-ph-funnel',
			}
		}),
)

const MODE_LABELS: Record<FilterMode, string> = {
	contains: 'dms_database.data.filters.contains',
	is: 'dms_database.data.filters.is',
}

const addOpen = ref(false)
const draftField = ref<string | undefined>()
const draftMode = ref<FilterMode>('contains')
const draftValue = ref('')

const fieldItems = computed(() =>
	props.columns
		.filter((column) => !isReservedFilterField(column.name))
		.map((column) => ({ label: column.name, value: column.name })),
)
const modeItems = computed(() =>
	(Object.keys(MODE_LABELS) as FilterMode[]).map((mode) => ({
		label: t(MODE_LABELS[mode]),
		value: mode,
	})),
)

watch(addOpen, (open) => {
	if (!open) return
	draftField.value = fieldItems.value[0]?.value
	draftMode.value = 'contains'
	draftValue.value = ''
})

function add() {
	const value = draftValue.value.trim()
	if (!draftField.value || !value) return
	emit('set', draftField.value, { mode: draftMode.value, value })
	addOpen.value = false
}
</script>

<template>
	<div
		class="border-default flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5"
	>
		<span
			v-for="chip in chips"
			:key="chip.field"
			class="border-accented bg-elevated inline-flex h-7 items-center overflow-hidden rounded-md border text-xs"
		>
			<span class="text-toned flex items-center gap-1 px-2 font-mono">
				<UIcon :name="chip.icon" class="text-dimmed size-3" />
				{{ chip.field }}
			</span>
			<span class="text-muted border-default border-l px-2">
				{{ t(MODE_LABELS[chip.filter.mode]) }}
			</span>
			<span
				class="text-highlighted border-default max-w-48 truncate border-l px-2 font-mono"
			>
				{{ chip.filter.value }}
			</span>
			<button
				type="button"
				class="text-dimmed hover:text-highlighted hover:bg-default border-default h-full border-l px-1.5"
				:aria-label="
					t('dms_database.data.filters.remove_chip', { column: chip.field })
				"
				:title="
					t('dms_database.data.filters.remove_chip', { column: chip.field })
				"
				@click="emit('set', chip.field, null)"
			>
				<UIcon name="i-ph-x" class="size-3" />
			</button>
		</span>
		<UPopover v-model:open="addOpen">
			<UButton
				size="xs"
				color="neutral"
				variant="ghost"
				icon="i-ph-plus"
				:label="t('dms_database.data.filters.add')"
				:disabled="fieldItems.length === 0"
			/>
			<template #content>
				<form class="grid w-64 gap-2 p-3" @submit.prevent="add">
					<USelect
						v-model="draftField"
						:items="fieldItems"
						size="xs"
						class="w-full font-mono"
					/>
					<USelect
						v-model="draftMode"
						:items="modeItems"
						size="xs"
						class="w-full"
					/>
					<UInput
						v-model="draftValue"
						size="xs"
						class="w-full"
						autofocus
						:placeholder="t('dms_database.data.filters.value')"
					/>
					<UButton
						type="submit"
						size="xs"
						class="justify-self-end"
						:label="t('dms_database.data.filters.apply')"
						:disabled="!draftValue.trim()"
					/>
				</form>
			</template>
		</UPopover>
		<UButton
			v-if="chips.length > 0"
			size="xs"
			color="neutral"
			variant="ghost"
			class="ml-auto"
			:label="t('dms_database.data.filters.clear_all')"
			@click="emit('clear')"
		/>
	</div>
</template>
