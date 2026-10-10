<script setup lang="ts">
import {
	ALL_ICON,
	PICK_ALL,
	PICKER_MENU_UI,
	SCHEMA_ICON,
	schemaMenu,
} from '../build/data/pickerMenus'
import { sortNames } from '../build/data/instanceOptions'

// A schema picked from a searchable menu, shared by the Schemas page's filter
// bar and the data browser's sidebar: "All schemas" pinned first when the
// page can list every schema, and at most a hundred others with how many
// matched.

const props = defineProps<{
	/** The schema picked; null for every schema (with `allowAll`) or none yet. */
	modelValue: string | null
	/** Every registered schema id, in any order. */
	schemaIds: readonly string[]
	/** Offers "All schemas", pinned first; otherwise a schema is required. */
	allowAll?: boolean
	/** The schema list is being read. */
	loading?: boolean
	disabled?: boolean
	/** Shown while no schema is picked, without `allowAll`. */
	placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [id: string | null] }>()

const { t, n } = useI18n()
const search = ref('')
const ids = computed(() => sortNames(props.schemaIds))

const items = computed(() =>
	schemaMenu({
		ids: ids.value,
		search: search.value,
		allLabel: props.allowAll ? t('dms_database.pickers.schema.all') : null,
		more: (shown, total) =>
			t('dms_database.pickers.schema.more', {
				shown: n(shown),
				total: n(total),
			}),
	}),
)

function pick(value: unknown) {
	if (typeof value !== 'string') return
	emit('update:modelValue', value === PICK_ALL ? null : value)
}
</script>

<template>
	<USelectMenu
		v-model:search-term="search"
		:model-value="modelValue ?? (allowAll ? PICK_ALL : undefined)"
		:items="items"
		value-key="value"
		ignore-filter
		:search-input="{
			placeholder: t('dms_database.pickers.schema.find'),
			icon: 'i-ph-magnifying-glass',
		}"
		:icon="modelValue || !allowAll ? SCHEMA_ICON : ALL_ICON"
		:loading="loading"
		:disabled="disabled"
		:aria-label="t('dms_database.pickers.schema.label')"
		size="sm"
		:ui="PICKER_MENU_UI"
		data-dms-database-schema-picker
		@update:model-value="pick"
	>
		<span v-if="modelValue" class="truncate font-mono">{{ modelValue }}</span>
		<span v-else-if="allowAll" class="truncate">
			{{ t('dms_database.pickers.schema.all') }}
		</span>
		<span v-else class="text-dimmed truncate">
			{{ placeholder ?? t('dms_database.pickers.schema.placeholder') }}
		</span>
		<template #empty>
			{{ t('dms_database.pickers.schema.no_match') }}
		</template>
	</USelectMenu>
</template>
