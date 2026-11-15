<script setup lang="ts">
import SchemaDiagramBoard from '../build/components/SchemaDiagramBoard.vue'
import { useDatabaseConnections } from '../build/composables/useDatabaseConnections'

const { ready } = useDatabaseConnections()

await ready
</script>

<template>
	<SchemaDiagramBoard />
</template>
