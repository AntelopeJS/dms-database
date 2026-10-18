<script setup lang="ts">
// The overview's schema cards: the DMS NavCardGrid block, a card per
// registered schema, read with the page. How many schemas there are decides
// the grid's rows, which no fixed count of placeholders can match: a client
// navigation waits for the cards, as a server render does, and a return to
// the page shows the last ones at once while they are read again.
interface SchemaCardsResponse {
	items: unknown[]
}

const SCHEMA_CARDS_ENDPOINT = '/api/database/overview/schemas'
const COLUMNS = 3
const EMPTY = {
	title: '$dms_database.overview.schemas.empty_title',
	description: '$dms_database.overview.schemas.empty_description',
}

const read = useApiData<SchemaCardsResponse>(SCHEMA_CARDS_ENDPOINT)
const { data, error } = read
// A failed read is not an empty list: the block reads the route itself then,
// to draw its error and retry.
const failed = computed(() => !data.value && Boolean(error.value))

await read
</script>

<template>
	<DmsNavCardGridBlock
		v-if="failed"
		:fetch-url="SCHEMA_CARDS_ENDPOINT"
		:columns="COLUMNS"
		:empty="EMPTY"
	/>
	<DmsNavCardGridBlock
		v-else
		:items="data?.items ?? []"
		:columns="COLUMNS"
		:empty="EMPTY"
	/>
</template>
