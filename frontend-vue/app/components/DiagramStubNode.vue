<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

import type { StubNodeData } from '../build/diagram/graph'

// A table a relation points to that is not drawn: one of another schema, or
// one the focus leaves out. The dashed chip opens it: in its own schema's
// diagram, or here, out of the focus.
defineProps<{ data: StubNodeData }>()
</script>

<template>
	<button
		type="button"
		class="diagram-stub-node border-accented bg-muted text-muted hover:border-primary hover:text-highlighted relative flex h-7 items-center gap-1.5 rounded-sm border border-dashed px-2.5 font-mono text-[11.5px] transition-colors"
		:title="
			$t('dms_database.diagram.stub_title', {
				schema: data.targetSchema,
				table: data.targetTable,
			})
		"
		@click="data.onOpenSchema(data.targetSchema, data.targetTable)"
	>
		<Handle id="stub::left::target" type="target" :position="Position.Left" />
		<Handle id="stub::right::target" type="target" :position="Position.Right" />
		<UIcon name="i-ph-arrow-square-out" class="text-dimmed size-3.5" />
		<span>{{ data.targetSchema }}.{{ data.targetTable }}</span>
	</button>
</template>

<style scoped>
.diagram-stub-node :deep(.vue-flow__handle) {
	opacity: 0;
	pointer-events: none;
}
</style>
