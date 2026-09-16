<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";

interface NodeData {
	tableName: string;
	fields: Record<string, unknown>;
	indexes: Record<string, { fields?: string[]; multi?: boolean }>;
	modifiers: Record<string, string[]>;
}

defineProps<{ data: NodeData }>();
</script>

<template>
	<div class="diagram-table-node bg-elevated border border-default rounded-lg w-60 shadow-md">
		<!-- Fallback handles on the node body for edges that reference a non-existent field -->
		<Handle id="__node__::left::source" type="source" :position="Position.Left" />
		<Handle id="__node__::left::target" type="target" :position="Position.Left" />
		<Handle id="__node__::right::source" type="source" :position="Position.Right" />
		<Handle id="__node__::right::target" type="target" :position="Position.Right" />

		<div class="px-3 py-2 border-b border-default flex items-center gap-2">
			<UIcon name="i-ph-table" />
			<span class="font-mono text-sm">{{ data.tableName }}</span>
		</div>

		<ul class="py-1">
			<li
				v-for="(fieldType, fieldName) in data.fields"
				:key="fieldName"
				class="relative flex items-center justify-between px-3 py-1 text-sm"
			>
				<Handle
					:id="`${fieldName}::left::source`"
					type="source"
					:position="Position.Left"
				/>
				<Handle
					:id="`${fieldName}::left::target`"
					type="target"
					:position="Position.Left"
				/>
				<Handle
					:id="`${fieldName}::right::source`"
					type="source"
					:position="Position.Right"
				/>
				<Handle
					:id="`${fieldName}::right::target`"
					type="target"
					:position="Position.Right"
				/>

				<span class="flex items-center gap-0.5 font-mono min-w-0">
					<UTooltip
						v-if="isPrimaryKey(String(fieldName), data.indexes)"
						text="Primary key"
					>
						<UIcon name="i-ph-key" class="text-amber-500 size-4 shrink-0" />
					</UTooltip>
					<template
						v-for="modifierId in data.modifiers?.[String(fieldName)] ?? []"
						:key="modifierId"
					>
						<UTooltip :text="resolveModifierIcon(modifierId).label">
							<UIcon
								:name="resolveModifierIcon(modifierId).icon"
								:class="[resolveModifierIcon(modifierId).color, 'size-4 shrink-0']"
							/>
						</UTooltip>
					</template>
					<span class="truncate ml-1">{{ fieldName }}</span>
				</span>

				<UTooltip :text="inferFieldTypeIcon(fieldType, String(fieldName)).label">
					<UIcon
						:name="inferFieldTypeIcon(fieldType, String(fieldName)).icon"
						:class="[
							inferFieldTypeIcon(fieldType, String(fieldName)).color,
							'size-4 shrink-0',
						]"
					/>
				</UTooltip>
			</li>
		</ul>
	</div>
</template>

<style scoped>
.diagram-table-node :deep(.vue-flow__handle) {
	opacity: 0;
	pointer-events: none;
}
</style>
