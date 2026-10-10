<script setup lang="ts">
import { onKeyStroke, watchDebounced } from '@vueuse/core'
import { useDatabaseSchemas } from '../build/composables/useDatabaseSchemas'
import {
	EMPTY_FILTER_STATE,
	HAS_FLAGS,
	isFiltered,
	toggleHas,
	withFilterState,
	withScope,
	type HasFlag,
	type InstanceChoice,
	type SchemasFilterState,
} from '../build/schemas/filterState'
import { useSchemasListing } from '../build/schemas/useSchemasListing'
import InstancePicker from './InstancePicker.vue'
import SchemaPicker from './SchemaPicker.vue'

// The Schemas page's filter bar, above its table view: a schema and an
// instance picked from searchable menus (SchemaPicker, InstancePicker, shared
// with the data browser), a table or column name, and structure chips. Its
// state lives in the URL (see filterState.ts), which the table view reads as
// hidden filters: a filtered list can be shared and reloaded.

const SEARCH_DEBOUNCE_MS = 250

const HAS_ICONS: Record<HasFlag, string> = {
	relations: 'i-ph-flow-arrow',
	modifiers: 'i-ph-sliders-horizontal',
	empty: 'i-ph-circle-dashed',
}

const { t, n } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const { schemas, isSettled: schemasSettled } = useDatabaseSchemas()
const schemaIds = computed(() => schemas.value.map((schema) => schema.id))
const listing = useSchemasListing()
const state = listing.state

function commit(next: SchemasFilterState) {
	router.replace({ query: withFilterState(route.query, next) })
}

const filtered = computed(() => isFiltered(state.value))

function clearAll() {
	search.value = ''
	commit(EMPTY_FILTER_STATE)
}

function pickSchema(id: string | null) {
	commit(withScope(state.value, id))
}

function pickInstance(instance: InstanceChoice) {
	commit({ ...state.value, instance })
}

// --- table or column name ---
const search = ref(state.value.q)
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement }>(
	'searchInput',
)

watchDebounced(
	search,
	(value) => {
		if (value.trim() !== state.value.q) commit({ ...state.value, q: value })
	},
	{ debounce: SEARCH_DEBOUNCE_MS },
)

// The URL changed by itself (Clear, Back, a link): the field follows.
watch(
	() => state.value.q,
	(q) => {
		if (q !== search.value.trim()) search.value = q
	},
)

function clearSearch() {
	search.value = ''
	commit({ ...state.value, q: '' })
}

onKeyStroke('/', (event) => {
	const target = event.target as HTMLElement | null
	if (target?.closest('input, textarea, select, [contenteditable=true]')) return
	if (event.metaKey || event.ctrlKey || event.altKey) return
	event.preventDefault()
	searchInput.value?.inputRef?.focus()
})

// --- structure chips and the count ---
const chips = computed(() =>
	HAS_FLAGS.map((flag) => ({
		flag,
		label: t(`dms_database.schemas.filters.has.${flag}`),
		hint: t(`dms_database.schemas.filters.has_hint.${flag}`),
		icon: HAS_ICONS[flag],
		active: state.value.has.includes(flag),
	})),
)

const count = computed(() => {
	if (listing.all.value === null) return null
	return t('dms_database.schemas.filters.count', {
		shown: n(listing.total.value),
		total: n(listing.all.value),
	})
})
</script>

<template>
	<div
		class="flex flex-wrap items-center gap-2"
		role="search"
		:aria-label="t('dms_database.schemas.filters.label')"
		data-dms-database-schemas-filter-bar
	>
		<SchemaPicker
			:model-value="state.scope"
			:schema-ids="schemaIds"
			allow-all
			:loading="!schemasSettled"
			class="w-[calc(50%-0.25rem)] sm:w-48"
			@update:model-value="pickSchema"
		/>

		<InstancePicker
			:model-value="state.instance"
			:schema="state.scope"
			class="w-[calc(50%-0.25rem)] sm:w-48"
			@update:model-value="pickInstance"
		/>

		<UInput
			ref="searchInput"
			v-model="search"
			icon="i-ph-magnifying-glass"
			size="sm"
			class="w-full sm:w-auto sm:min-w-56 sm:max-w-xs sm:flex-1"
			:placeholder="t('dms_database.schemas.search')"
			:aria-label="t('dms_database.schemas.search')"
			@keydown.esc="clearSearch"
		>
			<template #trailing>
				<UButton
					v-if="search"
					icon="i-ph-x"
					color="neutral"
					variant="link"
					size="xs"
					:aria-label="t('dms_database.schemas.filters.clear')"
					@click="clearSearch"
				/>
				<UKbd v-else value="/" size="sm" />
			</template>
		</UInput>

		<div class="flex flex-wrap items-center gap-1.5">
			<UButton
				v-for="chip in chips"
				:key="chip.flag"
				:icon="chip.icon"
				:label="chip.label"
				:title="chip.hint"
				:color="chip.active ? 'primary' : 'neutral'"
				:variant="chip.active ? 'soft' : 'outline'"
				:aria-pressed="chip.active"
				size="sm"
				class="rounded-full"
				@click="commit(toggleHas(state, chip.flag))"
			/>
		</div>

		<div
			v-if="filtered"
			class="text-muted ms-auto flex items-center gap-1 text-xs"
			role="status"
		>
			<span
				v-if="count"
				class="tabular-nums"
				:class="{ 'opacity-60': listing.status.value === 'pending' }"
			>
				{{ count }}
			</span>
			<span v-if="count" aria-hidden="true">·</span>
			<UButton
				:label="t('dms_database.schemas.filters.clear')"
				color="neutral"
				variant="link"
				size="xs"
				class="px-0"
				@click="clearAll"
			/>
		</div>
	</div>
</template>
