<script setup lang="ts">
import FeatureLocked from '../build/components/FeatureLocked.vue'
import QueryConsoleBoard from '../build/components/QueryConsoleBoard.vue'
import { useDatabaseConnections } from '../build/composables/useDatabaseConnections'

const { t } = useI18n()
const { lacks, ready } = useDatabaseConnections()

await ready
</script>

<template>
	<FeatureLocked
		v-if="lacks('queryConsole')"
		:title="t('dms_database.query.title')"
	/>
	<QueryConsoleBoard v-else />
</template>
