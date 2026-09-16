<script setup lang="ts">
const { schemas } = useDatabaseSchemas();
const { activeTab, restore } = useDataBrowserTabs();

onMounted(() => restore());

// Schema-introspected field names for the active tab's table: the grid falls
// back to them when the backend column sampling returns nothing (empty table).
const fallbackFields = computed(() => {
	const tab = activeTab.value;
	if (!tab) return [];
	const schema = schemas.value.find((s) => s.id === tab.schema);
	const table = schema?.tables.find((tbl) => tbl.name === tab.table);
	return Object.keys(table?.fields ?? {});
});
</script>

<template>
	<!-- Studio layout: full height, only the grid scrolls. The offset accounts
	     for the DMS shell chrome + page header — tune it at the visual
	     checkpoint so the page itself never scrolls. -->
	<div
		class="flex h-[calc(100dvh-13.5rem)] min-h-[30rem] overflow-hidden rounded-lg border border-default bg-default"
	>
		<DmsDatabaseDataBrowserSidebar :schemas="schemas" />
		<div class="flex min-w-0 flex-1 flex-col">
			<DmsDatabaseDataBrowserTabBar />
			<DmsDatabaseDataGrid
				v-if="activeTab"
				:key="activeTab.id"
				:tab="activeTab"
				:fallback-fields="fallbackFields"
			/>
			<div
				v-else
				class="flex flex-1 items-center justify-center text-sm text-muted"
			>
				{{ $t("dms_database.data.pickPrompt") }}
			</div>
		</div>
	</div>
</template>
