<script setup lang="ts">
import { BaseEdge, type EdgeProps, Position, getBezierPath } from "@vue-flow/core";

const props = defineProps<EdgeProps>();

const ARC_MIN_OFFSET = 60;
const ARC_DY_FACTOR = 0.35;

function sideSign(position: Position): 1 | -1 | 0 {
	if (position === Position.Right) return 1;
	if (position === Position.Left) return -1;
	return 0;
}

const computedPath = computed<[string, number, number]>(() => {
	const sourceSign = sideSign(props.sourcePosition);
	const targetSign = sideSign(props.targetPosition);
	if (sourceSign !== 0 && targetSign !== 0) {
		const dy = Math.abs(props.targetY - props.sourceY);
		const offset = Math.max(ARC_MIN_OFFSET, dy * ARC_DY_FACTOR);
		const cx1 = props.sourceX + sourceSign * offset;
		const cy1 = props.sourceY;
		const cx2 = props.targetX + targetSign * offset;
		const cy2 = props.targetY;
		const d = `M${props.sourceX},${props.sourceY} C${cx1},${cy1} ${cx2},${cy2} ${props.targetX},${props.targetY}`;
		// Label sits at the bezier midpoint (t = 0.5).
		const labelX =
			(props.sourceX + 3 * cx1 + 3 * cx2 + props.targetX) / 8;
		const labelY =
			(props.sourceY + 3 * cy1 + 3 * cy2 + props.targetY) / 8;
		return [d, labelX, labelY];
	}
	const [d, lx, ly] = getBezierPath({
		sourceX: props.sourceX,
		sourceY: props.sourceY,
		sourcePosition: props.sourcePosition,
		targetX: props.targetX,
		targetY: props.targetY,
		targetPosition: props.targetPosition,
	});
	return [d, lx, ly];
});
</script>

<template>
	<BaseEdge
		:id="id"
		:path="computedPath[0]"
		:marker-end="markerEnd"
		:marker-start="markerStart"
		:style="style"
		:label-x="computedPath[1]"
		:label-y="computedPath[2]"
		:label="undefined"
		:interaction-width="interactionWidth"
	/>
	<text
		v-if="label"
		class="vue-flow__edge-text"
		:x="computedPath[1]"
		:y="computedPath[2]"
		text-anchor="middle"
		dominant-baseline="middle"
		:style="labelStyle"
	>
		{{ label }}
	</text>
</template>
