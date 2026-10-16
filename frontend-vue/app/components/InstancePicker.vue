<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import {
	PICKER_LIMIT,
	type InstanceChoice,
} from '../build/data/instanceOptions'
import {
	ALL_ICON,
	INSTANCE_ICON,
	PICKER_MENU_UI,
	READ_ONLY_ICON,
	instanceMenu,
	instancePickChoice,
	instancePickValue,
	type AllInstancesMode,
	type InstancesStatus,
} from '../build/data/pickerMenus'

// An instance picked from a searchable menu, shared by the Schemas page's
// filter bar and the data browser's sidebar. A SaaS schema may hold one
// instance per tenant: the named ones load when the menu opens and the
// server searches them, a hundred at most with how many matched. "All
// instances" (with their count) and "default" are pinned first, "all" after
// the matches of a search; "all" is a filter on the Schemas page, the data
// browser's read-only view there.

const props = withDefaults(
	defineProps<{
		modelValue: InstanceChoice
		/** The schema whose named instances are listed; null for none. */
		schema: string | null
		allMode?: AllInstancesMode
		disabled?: boolean
	}>(),
	{ allMode: 'filter' },
)

const emit = defineEmits<{ 'update:modelValue': [choice: InstanceChoice] }>()

const INSTANCES_ENDPOINT = '/api/database/tables/instances'
const SEARCH_DEBOUNCE_MS = 250

/** One read of a schema's named instances, with what it searched. */
interface InstancesPage {
	schema: string
	term: string
	instances: string[]
	total: number
}

const { t, n } = useI18n()

const search = ref('')
// What the server searches: the term once typing settles.
const term = ref('')
const open = ref(false)

watchDebounced(search, (value) => (term.value = value.trim()), {
	debounce: SEARCH_DEBOUNCE_MS,
})

// Read when the menu opens, in the browser only, never on the page's
// refreshes: a closed menu shows nothing of it.
const instances = useApiData<InstancesPage>(
	() =>
		props.schema
			? `dms-database:instances:${JSON.stringify([props.schema, term.value])}`
			: null,
	async ({ $authFetch, signal }) => {
		const schema = props.schema as string
		const searched = term.value
		const page = await $authFetch<{ instances: string[]; total: number }>(
			INSTANCES_ENDPOINT,
			{
				query: { schema, search: searched || undefined, limit: PICKER_LIMIT },
				signal,
			},
		)
		return { schema, term: searched, ...page }
	},
	{
		immediate: false,
		server: false,
		watch: false,
		refreshOnPageRefresh: false,
	},
)

// Another schema shows none of the previous one's instances while its own
// load; another search keeps the previous matches on screen meanwhile.
const page = computed(() => {
	const value = instances.data.value
	return value?.schema === props.schema ? value : null
})
const names = computed(() => page.value?.instances ?? [])
const matched = computed(() => page.value?.total ?? 0)
const status = computed(() => instances.status.value as InstancesStatus)

// Named instances of the schema, before any search; null until known.
const unsearched = shallowRef<InstancesPage | null>(null)
watch(page, (value) => {
	if (value && !value.term) unsearched.value = value
})
const total = computed(() =>
	unsearched.value?.schema === props.schema ? unsearched.value.total : null,
)

function load() {
	if (!open.value || !props.schema) return
	if (instances.pending.value || instances.status.value === 'success') return
	void instances.execute()
}

watch([() => props.schema, term], load)

function onOpen(value: boolean) {
	open.value = value
	load()
}

const items = computed(() =>
	instanceMenu({
		search: search.value,
		hasSchema: Boolean(props.schema),
		names: names.value,
		matched: matched.value,
		total: total.value,
		status: status.value,
		allMode: props.allMode,
		labels: {
			all: t('dms_database.pickers.instance.all'),
			readOnly: t('dms_database.pickers.instance.read_only'),
			default: t('dms_database.pickers.instance.default'),
			pickSchema: t('dms_database.pickers.instance.pick_schema'),
			loading: t('dms_database.pickers.instance.loading'),
			failed: t('dms_database.pickers.instance.failed'),
			noNamed: t('dms_database.pickers.instance.no_named'),
			noMatch: t('dms_database.pickers.instance.no_match'),
			more: (shown, all) =>
				t('dms_database.pickers.instance.more', {
					shown: n(shown),
					total: n(all),
				}),
			count: (value) => n(value),
		},
	}),
)

const name = computed(() => {
	const choice = props.modelValue
	if (choice.kind === 'all') return t('dms_database.pickers.instance.all')
	if (choice.kind === 'default')
		return t('dms_database.pickers.instance.default')
	return choice.id
})

const icon = computed(() => {
	if (props.modelValue.kind !== 'all') return INSTANCE_ICON
	return props.allMode === 'readonly' ? READ_ONLY_ICON : ALL_ICON
})

function pick(value: unknown) {
	if (typeof value === 'string')
		emit('update:modelValue', instancePickChoice(value))
}
</script>

<template>
	<USelectMenu
		v-model:search-term="search"
		:model-value="instancePickValue(modelValue)"
		:items="items"
		value-key="value"
		ignore-filter
		:search-input="{
			placeholder: t('dms_database.pickers.instance.find'),
			icon: 'i-ph-magnifying-glass',
		}"
		:icon="icon"
		:disabled="disabled"
		:aria-label="t('dms_database.pickers.instance.label')"
		size="sm"
		:ui="PICKER_MENU_UI"
		data-dms-database-instance-picker
		@update:open="onOpen"
		@update:model-value="pick"
	>
		<span
			class="truncate"
			:class="{ 'font-mono': modelValue.kind !== 'all' }"
			:title="
				modelValue.kind === 'all' && allMode === 'readonly'
					? t('dms_database.pickers.instance.read_only')
					: undefined
			"
		>
			{{ name }}
		</span>
		<template #empty>
			{{ t('dms_database.pickers.instance.no_match') }}
		</template>
	</USelectMenu>
</template>
