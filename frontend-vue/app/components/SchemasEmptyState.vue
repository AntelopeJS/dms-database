<script setup lang="ts">
import {
	EMPTY_FILTER_STATE,
	isFiltered,
	readFilterState,
	withFilterState,
} from '../build/schemas/filterState'
import { useCurrentRoute } from '../build/schemas/useSchemasListing'

// The Schemas table's empty body when it lists nothing. The table view
// counts no filter of the page's filter bar (hidden filters) as a filter, so
// it calls this "first run" either way: with the bar narrowing the list, it
// says no table matches and clears the bar; without, that no module declared
// a table yet.

defineProps<{
	state?: string
	search?: string
	refresh?: () => void
}>()

const { t } = useI18n()
// Not useDmsRoute(): mounted each time the list comes back empty, it would
// make the table view list again, and again (see useCurrentRoute).
const route = useCurrentRoute()
const router = useDmsRouter()

const filtered = computed(() => isFiltered(readFilterState(route.value.query)))

function clearFilters() {
	router.replace({
		query: withFilterState(route.value.query, EMPTY_FILTER_STATE),
	})
}
</script>

<template>
	<DmsEmptyState
		v-if="filtered"
		variant="no-result"
		:title="t('dms_database.schemas.empty.no_result_title')"
		:description="t('dms_database.schemas.empty.no_result_description')"
		:actions="[
			{
				label: t('dms_database.schemas.empty.clear_filters'),
				icon: 'i-ph-x',
				color: 'neutral',
				variant: 'outline',
				size: 'md',
				onClick: clearFilters,
			},
		]"
		size="lg"
		hatched
		class="z-10 w-full"
	/>
	<DmsEmptyState
		v-else
		variant="no-data"
		icon="i-ph-stack"
		:title="t('dms_database.schemas.empty.first_title')"
		:description="t('dms_database.schemas.empty.first_description')"
		size="lg"
		hatched
		class="z-10 w-full"
	/>
</template>
