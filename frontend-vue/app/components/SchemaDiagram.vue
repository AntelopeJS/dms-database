<script setup lang="ts">
import FeatureLocked from '../build/components/FeatureLocked.vue'
import SchemaDiagramBoard from '../build/components/SchemaDiagramBoard.vue'
import { useDatabaseConnections } from '../build/composables/useDatabaseConnections'

const { t } = useI18n()
const { lacks, ready } = useDatabaseConnections()

await ready
</script>

<template>
	<FeatureLocked
		v-if="lacks('diagram')"
		:title="t('dms_database.diagram.title')"
	/>
	<SchemaDiagramBoard v-else />
</template>
