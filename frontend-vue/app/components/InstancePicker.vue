<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import {
	INSTANCE_PICKER_LIMIT,
	type InstanceChoice,
} from '../build/data/instanceOptions'
import {
	ALL_ICON,
	INSTANCE_ICON,
	PICKER_MENU_UI,
	READ_ONLY_ICON,
	READ_ONLY_ITEM_CLASS,
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
// instances" (with their count) and "default" are pinned first; "all" is a
// filter on the Schemas page, the data browser's read-only view there.

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

const { t, n } = useI18n()
const { $authFetch } = useAuthFetch()

const search = ref('')
const open = ref(false)
const names = ref<string[]>([])
const matched = ref(0)
// Named instances of the schema, before any search; null until known.
const total = ref<number | null>(null)
const status = ref<InstancesStatus>('idle')
let request = 0
let loadedKey: string | null = null

async function load() {
	const schema = props.schema
	if (!schema) return
	const term = search.value.trim()
	const key = `${schema}\u0000${term}`
	if (key === loadedKey) return
	const current = ++request
	status.value = 'pending'
	try {
		const res = await $authFetch<{ instances: string[]; total: number }>(
			INSTANCES_ENDPOINT,
			{
				query: {
					schema,
					search: term || undefined,
					limit: INSTANCE_PICKER_LIMIT,
				},
			},
		)
		if (current !== request) return
		names.value = res.instances
		matched.value = res.total
		if (!term) total.value = res.total
		status.value = 'success'
		loadedKey = key
	} catch {
		if (current === request) status.value = 'error'
	}
}

// Another schema, other instances: they load when the menu opens.
watch(
	() => props.schema,
	() => {
		request++
		loadedKey = null
		names.value = []
		matched.value = 0
		total.value = null
		status.value = 'idle'
		if (open.value) void load()
	},
)

function onOpen(value: boolean) {
	open.value = value
	if (value) void load()
}

watchDebounced(
	search,
	() => {
		if (open.value) void load()
	},
	{ debounce: SEARCH_DEBOUNCE_MS },
)

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

// Typing in the search (clearing it too) highlights the first item: past the
// read-only view, so that Enter picks the first instance one can edit. The
// opened menu still highlights the picked one. The menu offers no way to
// highlight an item, its search field steps down the list.
const menu = useTemplateRef<{ viewportRef?: HTMLElement | null }>('menu')
let searched = false

watch(open, () => {
	searched = false
})

watch(search, () => {
	if (open.value) searched = true
})

watch(
	items,
	async () => {
		if (props.allMode !== 'readonly' || !open.value || !searched) return
		// Once the menu has highlighted the search's first item, and shown it.
		await new Promise((resolve) => setTimeout(resolve))
		const viewport = menu.value?.viewportRef
		const field = viewport
			?.closest('[data-slot="content"]')
			?.querySelector('input')
		if (!viewport || !field) return
		const highlighted = viewport.querySelector('[data-highlighted]')
		if (highlighted && !highlighted.classList.contains(READ_ONLY_ITEM_CLASS))
			return
		const down = () =>
			field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
		// Nothing highlighted: the first step lands on the read-only view.
		if (!highlighted) down()
		down()
	},
	{ flush: 'post' },
)

function pick(value: unknown) {
	if (typeof value === 'string')
		emit('update:modelValue', instancePickChoice(value))
}
</script>

<template>
	<USelectMenu
		ref="menu"
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
