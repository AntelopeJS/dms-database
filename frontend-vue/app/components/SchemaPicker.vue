<script setup lang="ts">
import {
	ALL_ICON,
	PICK_ALL,
	PICKER_MENU_UI,
	SCHEMA_ICON,
	schemaMenu,
} from '../build/data/pickerMenus'
import {
	recentSchemas,
	rememberSchema,
	sortSchemaIds,
} from '../build/data/schemaOptions'

// A schema picked from a searchable menu, shared by the Schemas page's filter
// bar and the data browser's sidebar: "All schemas" pinned first when the
// page can list every schema, the last few picked at hand, and at most a
// hundred others with how many matched.

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

// Kept across pages: a schema picked on the Schemas page is at hand in the
// data browser, and back.
const RECENT_STORAGE_KEY = 'dms-database:schemas:recent-schemas'

const { t, n } = useI18n()
const search = ref('')
const ids = computed(() => sortSchemaIds(props.schemaIds))
const recent = ref<string[]>([])

function readRecent(): unknown {
	try {
		return JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? '[]')
	} catch {
		return []
	}
}

function writeRecent(list: string[]) {
	try {
		localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(list))
	} catch {
		// Storage refused (private window): recents just are not kept.
	}
}

// Read once mounted: the server renders without the browser's storage.
onMounted(() => {
	watch(
		ids,
		(list) => {
			recent.value = recentSchemas(readRecent(), new Set(list))
		},
		{ immediate: true },
	)
})

const items = computed(() =>
	schemaMenu({
		ids: ids.value,
		recent: recent.value,
		search: search.value,
		allLabel: props.allowAll ? t('dms_database.pickers.schema.all') : null,
		recentLabel: t('dms_database.pickers.schema.recent'),
		more: (shown, total) =>
			t('dms_database.pickers.schema.more', {
				shown: n(shown),
				total: n(total),
			}),
	}),
)

function pick(value: unknown) {
	if (typeof value !== 'string') return
	const id = value === PICK_ALL ? null : value
	if (id) {
		recent.value = rememberSchema(recent.value, id)
		writeRecent(recent.value)
	}
	emit('update:modelValue', id)
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
