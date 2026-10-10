<script setup lang="ts">
import {
	instanceBadge,
	useDataBrowserTabs,
} from '../build/composables/useDataBrowserTabs'
import { useDatabaseSchemas } from '../build/composables/useDatabaseSchemas'
import { formatDatabaseRelativeTime } from '../build/utils/relativeTime'
import { type RecentTable, readRecentTables } from '../build/data/recentTables'
import { useStagedEdits } from '../build/data/stagedEdits'
import DataBrowserSidebar from './DataBrowserSidebar.vue'
import DataBrowserTabBar from './DataBrowserTabBar.vue'
import DataGrid from './DataGrid.vue'

// The data browser: a table list scoped to one schema and instance, the open
// tables as tabs, and the grid of the active one. Edits are staged per tab
// and written only when saved; leaving with staged edits asks first.

const { t, locale } = useI18n()
const {
	schemas,
	findTable,
	isLoading: schemasLoading,
	error: schemasError,
	refresh: refreshSchemas,
} = useDatabaseSchemas()
const { tabs, activeTab, restore, openTab, openFromRoute } =
	useDataBrowserTabs()
const staged = useStagedEdits()
const route = useDmsRoute()

onMounted(() => restore())
// A link from this page to another table (a relation) keeps the page mounted.
watch(
	() => route.query,
	() => openFromRoute(),
)

const hasStagedEdits = computed(() =>
	tabs.value.some((tab) => staged.count(tab.id) > 0),
)
useUnsavedChanges({ dirty: hasStagedEdits })

// Schema-introspected columns of the active table: the grid falls back to
// them when sampling finds no row, and reads its relation columns from them.
const activeTableSummary = computed(() =>
	activeTab.value
		? findTable(activeTab.value.schema, activeTab.value.table)
		: undefined,
)

// Read once mounted: the server renders without the browser's storage, and
// a list only the client has would not match its markup.
const recent = ref<RecentTable[]>([])
onMounted(() => {
	recent.value = readRecentTables()
})
watch(activeTab, () => {
	recent.value = readRecentTables()
})

function instanceLabel(instance: string): string {
	return instanceBadge(instance, t('dms_database.data.scope.all')) ?? ''
}
</script>

<template>
	<div
		class="border-default bg-default flex min-h-0 flex-1 overflow-hidden rounded-xl border"
	>
		<DataBrowserSidebar
			:schemas="schemas"
			:loading="schemasLoading"
			:error="Boolean(schemasError)"
			@retry="refreshSchemas()"
		/>
		<section class="flex min-w-0 flex-1 flex-col">
			<DataBrowserTabBar />
			<DataGrid
				v-if="activeTab"
				:key="activeTab.id"
				:tab="activeTab"
				:table="activeTableSummary"
			/>
			<div v-else class="grid flex-1 place-items-center p-6">
				<DmsEmptyState
					icon="i-ph-rows"
					:title="t('dms_database.data.empty.pick_title')"
					:description="
						recent.length
							? t('dms_database.data.empty.pick_description')
							: t('dms_database.data.empty.pick_description_first')
					"
				>
					<template v-if="recent.length" #actions>
						<div class="grid w-full max-w-sm gap-1.5">
							<DmsEyebrow :label="t('dms_database.data.empty.recent')" />
							<button
								v-for="entry in recent"
								:key="`${entry.schema}.${entry.instance}.${entry.table}`"
								type="button"
								class="border-default hover:bg-elevated flex items-center gap-2 rounded-md border px-3 py-2 text-left font-mono text-[12.5px]"
								@click="
									openTab(entry.schema, entry.instance, entry.table, false)
								"
							>
								<UIcon name="i-ph-table" class="text-primary size-3.5" />
								<span class="text-toned">
									{{ entry.schema }}.{{ entry.table }}
								</span>
								<span
									v-if="instanceLabel(entry.instance)"
									class="text-primary text-[11px]"
								>
									{{ instanceLabel(entry.instance) }}
								</span>
								<span class="text-dimmed ml-auto font-sans text-xs">
									{{ formatDatabaseRelativeTime(entry.openedAt, locale) }}
								</span>
							</button>
						</div>
					</template>
				</DmsEmptyState>
			</div>
		</section>
	</div>
</template>
