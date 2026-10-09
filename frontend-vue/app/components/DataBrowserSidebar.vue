<script setup lang="ts">
import {
	CROSS_INSTANCE_VALUE,
	DEFAULT_INSTANCE_VALUE,
	instanceChoiceOf,
	tabInstanceOf,
	useDataBrowserTabs,
} from '../build/composables/useDataBrowserTabs'
import { isFilterToken } from '../build/composables/useDataBrowserGrid'
import type { InstanceChoice } from '../build/data/instanceOptions'
import { onKeyStroke } from '@vueuse/core'
import type { SchemaSummary } from '../build/composables/useDatabaseSchemas'
import InstancePicker from './InstancePicker.vue'
import SchemaPicker from './SchemaPicker.vue'

// The data browser's scope (D-04): a labelled schema picker, the instance
// ("all" is read-only), both the Schemas page's searchable pickers, the table
// search under them, and the schema's tables with their row count in that
// instance. A
// table open in a tab carries a hollow ring, the active one included: the
// fill of the row says which is shown.

const TABLES_ENDPOINT = '/api/database/browse/tables'

interface TableEntry {
	name: string
	elementCount: number
}

const props = defineProps<{
	schemas: SchemaSummary[]
	/** The schema list is being read. */
	loading?: boolean
	/** The schema list could not be read. */
	error?: boolean
}>()

const emit = defineEmits<{ retry: [] }>()

const { t, n } = useI18n()
const { $authFetch } = useAuthFetch()
const { tabs, activeId, activeTab, activations, openTab } = useDataBrowserTabs()
const route = useDmsRoute()

const schemaId = ref<string | null>(null)
const instance = ref<string>(DEFAULT_INSTANCE_VALUE)
const filter = ref('')
const filterInput = useTemplateRef<{ inputRef?: HTMLInputElement }>(
	'filterInput',
)

// A schema-only link (?schema=X with no table) picks the schema; otherwise
// the active tab leads, then the first schema. A schema or instance picked
// here holds until the user goes to a tab (another one, or the same again).
const linkedSchema =
	typeof route.query.schema === 'string' && !route.query.table
		? route.query.schema
		: null

watch(
	[activeId, activations],
	() => {
		const tab = activeTab.value
		if (!tab) return
		schemaId.value = tab.schema
		instance.value = tab.instance
	},
	{ immediate: true },
)

watch(
	() => props.schemas,
	(list) => {
		if (schemaId.value || list.length === 0) return
		const linked = list.find((schema) => schema.id === linkedSchema)
		schemaId.value = linked?.id ?? list[0]?.id ?? null
	},
	{ immediate: true },
)

function pickSchema(id: string | null) {
	if (!id) return
	schemaId.value = id
	// Named instances belong to one schema.
	instance.value = DEFAULT_INSTANCE_VALUE
}

function pickInstance(choice: InstanceChoice) {
	instance.value = tabInstanceOf(choice)
}

const schema = computed(
	() => props.schemas.find((s) => s.id === schemaId.value) ?? null,
)
// Nothing to list yet: the list is read, or failed to be.
const schemasPending = computed(
	() => Boolean(props.loading) && props.schemas.length === 0,
)
const schemasFailed = computed(
	() => Boolean(props.error) && !props.loading && props.schemas.length === 0,
)
const schemaIds = computed(() => props.schemas.map((s) => s.id))
const instanceChoice = computed(() => instanceChoiceOf(instance.value))
// The footer names the instance as a tab's badge does ("all").
const instanceName = computed(() => {
	if (instance.value === DEFAULT_INSTANCE_VALUE)
		return t('dms_database.pickers.instance.default')
	if (instance.value === CROSS_INSTANCE_VALUE)
		return t('dms_database.data.scope.all')
	return instance.value
})

// --- tables and their counts in the picked instance ---
const counts = ref<Record<string, number>>({})
const countsFailed = ref(false)

watch(
	[schemaId, instance],
	async ([id, picked]) => {
		counts.value = {}
		countsFailed.value = false
		if (!id) return
		const query: Record<string, string> = { filter_schema: isFilterToken(id) }
		if (picked !== DEFAULT_INSTANCE_VALUE)
			query.filter_instance = isFilterToken(picked)
		try {
			const res = await $authFetch<{ items: TableEntry[] }>(TABLES_ENDPOINT, {
				query,
			})
			if (schemaId.value !== id || instance.value !== picked) return
			counts.value = Object.fromEntries(
				res.items.map((item) => [item.name, item.elementCount]),
			)
		} catch {
			if (schemaId.value === id) countsFailed.value = true
		}
	},
	{ immediate: true },
)

const openIds = computed(() => new Set(tabs.value.map((tab) => tab.id)))

const tables = computed(() => {
	const needle = filter.value.trim().toLowerCase()
	return (schema.value?.tables ?? [])
		.filter((table) => !needle || table.name.toLowerCase().includes(needle))
		.map((table) => ({
			name: table.name,
			count: counts.value[table.name],
			open: openIds.value.has(
				`${schemaId.value}::${instance.value}::${table.name}`,
			),
			active:
				activeTab.value?.schema === schemaId.value &&
				activeTab.value?.instance === instance.value &&
				activeTab.value?.table === table.name,
		}))
})

// A click opens a preview tab, a double-click (or a modified click) keeps it.
function open(name: string, event?: MouseEvent) {
	if (!schemaId.value) return
	const keep = Boolean(
		event && (event.metaKey || event.ctrlKey || event.altKey),
	)
	openTab(schemaId.value, instance.value, name, !keep)
}

function keep(name: string) {
	if (schemaId.value) openTab(schemaId.value, instance.value, name, false)
}

function clearFilter() {
	filter.value = ''
}

onKeyStroke('t', (event) => {
	const target = event.target as HTMLElement | null
	if (target?.closest('input, textarea, [contenteditable=true]')) return
	if (event.metaKey || event.ctrlKey || event.altKey) return
	event.preventDefault()
	filterInput.value?.inputRef?.focus()
})
</script>

<template>
	<aside
		class="border-default bg-default flex h-full w-[264px] shrink-0 flex-col border-r"
	>
		<div class="border-default grid gap-2 border-b p-3">
			<DmsEyebrow :label="t('dms_database.data.scope.schema')" />
			<SchemaPicker
				:model-value="schemaId"
				:schema-ids="schemaIds"
				:placeholder="
					schemasPending
						? t('dms_database.data.scope.loading_schemas')
						: undefined
				"
				:loading="schemasPending"
				:disabled="schemasPending || schemasFailed"
				class="w-full"
				@update:model-value="pickSchema"
			/>
			<DmsEyebrow class="mt-1" :label="t('dms_database.data.scope.instance')" />
			<InstancePicker
				:model-value="instanceChoice"
				:schema="schemaId"
				all-mode="readonly"
				:disabled="!schemaId"
				class="w-full"
				@update:model-value="pickInstance"
			/>
			<DmsEyebrow class="mt-1" :label="t('dms_database.data.scope.search')" />
			<UInput
				ref="filterInput"
				v-model="filter"
				icon="i-ph-magnifying-glass"
				size="sm"
				class="w-full"
				:placeholder="t('dms_database.data.scope.find_table')"
				:aria-label="t('dms_database.data.scope.find_table')"
				:disabled="!schemaId"
				@keydown.esc="clearFilter"
			>
				<template #trailing>
					<UButton
						v-if="filter"
						icon="i-ph-x"
						color="neutral"
						variant="link"
						size="xs"
						:aria-label="t('dms_database.common.clear')"
						@click="clearFilter"
					/>
					<UKbd v-else value="T" size="sm" />
				</template>
			</UInput>
		</div>

		<div class="flex min-h-0 flex-1 flex-col p-2">
			<div class="flex items-center justify-between px-2 py-1">
				<DmsEyebrow
					:label="t('dms_database.data.scope.tables', { count: tables.length })"
				/>
				<DmsEyebrow :label="t('dms_database.data.scope.rows')" />
			</div>
			<nav class="min-h-0 flex-1 overflow-y-auto">
				<div
					v-if="schemasPending"
					class="grid gap-1.5 px-2 py-1"
					role="status"
					:aria-label="t('dms_database.data.scope.loading_schemas')"
				>
					<USkeleton v-for="index in 6" :key="index" class="h-5 w-full" />
				</div>
				<DmsEmptyState
					v-else-if="schemasFailed"
					variant="error"
					size="sm"
					:title="t('dms_database.data.scope.schemas_failed')"
					:actions="[
						{
							label: t('dms_database.common.retry'),
							icon: 'i-ph-arrows-clockwise',
							color: 'neutral',
							variant: 'outline',
							size: 'xs',
							onClick: () => emit('retry'),
						},
					]"
				/>
				<button
					v-for="table in tables"
					:key="table.name"
					type="button"
					class="flex w-full select-none items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
					:class="
						table.active
							? 'bg-primary/10 text-primary'
							: 'text-toned hover:bg-elevated'
					"
					:title="t('dms_database.data.scope.open_hint')"
					@click="open(table.name, $event)"
					@dblclick="keep(table.name)"
				>
					<UIcon
						name="i-ph-table"
						class="size-3.5 shrink-0"
						:class="table.active ? 'text-primary' : 'text-dimmed'"
					/>
					<span class="min-w-0 flex-1 truncate font-mono text-xs">
						{{ table.name }}
					</span>
					<span
						v-if="table.open"
						class="size-2 shrink-0 rounded-full border-[1.5px] border-current"
						:class="table.active ? 'text-primary' : 'text-dimmed'"
						:title="t('dms_database.data.scope.open_tab')"
					>
						<span class="sr-only">
							{{ t('dms_database.data.scope.open_tab') }}
						</span>
					</span>
					<span
						v-if="table.count !== undefined"
						class="text-dimmed shrink-0 font-mono text-[10.5px] tabular-nums"
					>
						{{ n(table.count) }}
					</span>
				</button>
				<p
					v-if="schemaId && tables.length === 0"
					class="text-muted px-2 py-4 text-center text-xs"
				>
					{{ t('dms_database.data.scope.no_table') }}
				</p>
			</nav>
		</div>
		<footer
			class="border-default text-dimmed flex items-center gap-1.5 border-t px-3 py-2 text-[11.5px]"
		>
			<UIcon
				:name="countsFailed ? 'i-ph-warning' : 'i-ph-info'"
				class="size-3.5 shrink-0"
			/>
			<span v-if="countsFailed">
				{{ t('dms_database.data.scope.counts_failed') }}
			</span>
			<i18n-t v-else keypath="dms_database.data.scope.counts_for" tag="span">
				<template #instance>
					<span class="text-primary font-mono">{{ instanceName }}</span>
				</template>
			</i18n-t>
		</footer>
	</aside>
</template>
