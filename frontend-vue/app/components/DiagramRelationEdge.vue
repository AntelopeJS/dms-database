<script setup lang="ts">
import {
	BaseEdge,
	type EdgeProps,
	Position,
	getBezierPath,
} from '@vue-flow/core'
import { EDGE_ACTIVE_COLOR, type EdgeEnds } from '../build/diagram/graph'

// A relation column pointing at a table. The relations of the selected table
// are drawn in the primary colour; the others stay quiet.
const props = defineProps<EdgeProps<EdgeEnds>>()

const edgeStyle = computed(() =>
	props.data?.active
		? { ...(props.style as object), stroke: EDGE_ACTIVE_COLOR, strokeWidth: 2 }
		: props.style,
)

const ARC_MIN_OFFSET = 60
const ARC_DY_FACTOR = 0.35

function sideSign(position: Position): 1 | -1 | 0 {
	if (position === Position.Right) return 1
	if (position === Position.Left) return -1
	return 0
}

const computedPath = computed<[string, number, number]>(() => {
	const sourceSign = sideSign(props.sourcePosition)
	const targetSign = sideSign(props.targetPosition)
	if (sourceSign !== 0 && targetSign !== 0) {
		const dy = Math.abs(props.targetY - props.sourceY)
		const offset = Math.max(ARC_MIN_OFFSET, dy * ARC_DY_FACTOR)
		const cx1 = props.sourceX + sourceSign * offset
		const cy1 = props.sourceY
		const cx2 = props.targetX + targetSign * offset
		const cy2 = props.targetY
		const d = `M${props.sourceX},${props.sourceY} C${cx1},${cy1} ${cx2},${cy2} ${props.targetX},${props.targetY}`
		// Label sits at the bezier midpoint (t = 0.5).
		const labelX = (props.sourceX + 3 * cx1 + 3 * cx2 + props.targetX) / 8
		const labelY = (props.sourceY + 3 * cy1 + 3 * cy2 + props.targetY) / 8
		return [d, labelX, labelY]
	}
	const [d, lx, ly] = getBezierPath({
		sourceX: props.sourceX,
		sourceY: props.sourceY,
		sourcePosition: props.sourcePosition,
		targetX: props.targetX,
		targetY: props.targetY,
		targetPosition: props.targetPosition,
	})
	return [d, lx, ly]
})
</script>

<template>
	<BaseEdge
		:id="id"
		:path="computedPath[0]"
		:marker-end="markerEnd"
		:marker-start="markerStart"
		:style="edgeStyle"
		:label-x="computedPath[1]"
		:label-y="computedPath[2]"
		:label="undefined"
		:interaction-width="interactionWidth"
	/>
	<text
		v-if="label"
		class="diagram-edge-label"
		:class="{ 'diagram-edge-label--active': data?.active }"
		:x="computedPath[1]"
		:y="computedPath[2]"
		text-anchor="middle"
		dominant-baseline="middle"
	>
		{{ label }}
	</text>
</template>

<style scoped>
/* Theme tokens, with a halo of the canvas colour so the line that crosses
   the label does not run through its letters. */
.diagram-edge-label {
	fill: var(--ui-text-muted);
	stroke: var(--ui-bg-muted);
	stroke-width: 4px;
	stroke-linejoin: round;
	paint-order: stroke;
	font: 500 10.5px var(--font-mono, ui-monospace, monospace);
	pointer-events: none;
	user-select: none;
}
.diagram-edge-label--active {
	fill: var(--ui-primary);
}
</style>
