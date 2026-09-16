<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";

interface StubNodeData {
	targetSchema: string;
	targetTable: string;
}

defineProps<{ data: StubNodeData }>();

const route = useDmsRoute();
const router = useDmsRouter();

function jumpToSchema(schemaId: string) {
	router.replace({ query: { ...route.query, schema: schemaId } });
}
</script>

<template>
	<button
		type="button"
		class="diagram-stub-node flex items-center gap-1 px-2 py-1 rounded border border-dashed border-default bg-elevated text-xs text-muted hover:text-highlighted hover:border-primary transition-colors opacity-70 relative"
		@click="jumpToSchema(data.targetSchema)"
	>
		<Handle id="stub::left::target" type="target" :position="Position.Left" />
		<Handle id="stub::right::target" type="target" :position="Position.Right" />
		<UIcon name="i-ph-arrow-right" />
		<span class="font-mono">{{ data.targetSchema }}.{{ data.targetTable }}</span>
	</button>
</template>

<style scoped>
.diagram-stub-node :deep(.vue-flow__handle) {
	opacity: 0;
	pointer-events: none;
}
</style>
