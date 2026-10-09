<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import type { TableNodeData } from '../build/diagram/graph'
import {
	COLUMN_ROLE_CLASSES,
	type ColumnRole,
	describeField,
	describeModifier,
	isPrimaryKey,
} from '../build/utils/fieldTypes'

// One table of the diagram (D-09): each column with its type as mono text and
// a neutral icon. Colour only marks structure: the primary key, and the
// relation columns, which light up with the selected table's relations.

// The canvas keeps the selection in `data.selected`: Vue Flow's own one is
// off for tables, so one table at most is drawn selected.
const props = defineProps<{ data: TableNodeData }>()

const SIDES = ['left', 'right'] as const
const KINDS = ['source', 'target'] as const
const HANDLE_POSITIONS = { left: Position.Left, right: Position.Right } as const

const relationTargets = computed(
	() =>
		new Map(
			props.data.table.relations.map((relation) => [
				relation.fromField,
				relation,
			]),
		),
)

const rows = computed(() =>
	Object.entries(props.data.table.fields).map(([name, descriptor]) => {
		const key = isPrimaryKey(name, props.data.table.indexes ?? {})
		const relation = relationTargets.value.get(name)
		const role: ColumnRole = key ? 'key' : relation ? 'relation' : 'plain'
		const type = describeField(descriptor, name)
		return {
			name,
			role,
			icon: key ? 'i-ph-key' : relation ? 'i-ph-arrow-right' : type.icon,
			type: relation ? relation.toTable : type.label,
			modifiers: (props.data.table.modifiers?.[name] ?? []).map(
				describeModifier,
			),
			highlighted: props.data.highlighted.includes(name),
		}
	}),
)
</script>

<template>
	<div
		class="diagram-table-node bg-default w-[232px] cursor-grab rounded-md border text-xs shadow-sm transition-[opacity,border-color,box-shadow]"
		:class="[
			data.selected
				? 'border-primary shadow-[0_0_0_3px_var(--ui-color-primary-500)]/20 ring-primary/30 ring-2'
				: 'border-accented',
			data.dimmed ? 'opacity-45' : '',
		]"
	>
		<template v-for="side in SIDES" :key="side">
			<Handle
				v-for="kind in KINDS"
				:id="`__node__::${side}::${kind}`"
				:key="kind"
				:type="kind"
				:position="HANDLE_POSITIONS[side]"
			/>
		</template>

		<div
			class="border-default flex h-9 items-center gap-2 border-b pl-3 pr-2.5"
		>
			<UIcon name="i-ph-table" class="text-primary size-[15px] shrink-0" />
			<span
				class="text-highlighted truncate font-mono text-[12.5px] font-semibold"
			>
				{{ data.tableName }}
			</span>
		</div>

		<ul class="py-1">
			<li
				v-for="row in rows"
				:key="row.name"
				class="relative flex h-6 items-center gap-1.5 pl-3 pr-2.5 font-mono"
				:class="[
					row.role === 'relation' ? 'text-primary' : 'text-toned',
					row.highlighted ? 'bg-primary/10' : '',
				]"
			>
				<template v-for="side in SIDES" :key="side">
					<Handle
						v-for="kind in KINDS"
						:id="`${row.name}::${side}::${kind}`"
						:key="kind"
						:type="kind"
						:position="HANDLE_POSITIONS[side]"
					/>
				</template>
				<UIcon
					:name="row.icon"
					class="size-3 shrink-0"
					:class="
						row.role === 'plain' ? 'text-dimmed' : COLUMN_ROLE_CLASSES[row.role]
					"
				/>
				<span class="truncate">{{ row.name }}</span>
				<UIcon
					v-for="modifier in row.modifiers"
					:key="modifier.id"
					:name="modifier.icon"
					class="text-dimmed size-3 shrink-0"
					:title="modifier.labelKey ? $t(modifier.labelKey) : modifier.id"
				/>
				<span class="text-dimmed ml-auto max-w-24 truncate pl-2 text-[10.5px]">
					{{ row.type }}
				</span>
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
