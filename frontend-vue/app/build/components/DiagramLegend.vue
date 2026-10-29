<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
	<div class="diagram-legend">
		<span>
			<UIcon name="i-ph-key" class="text-warning" />
			{{ t('dms_database.diagram.legend.key') }}
		</span>
		<span>
			<UIcon name="i-ph-arrow-right" class="text-primary" />
			{{ t('dms_database.diagram.legend.relation') }}
		</span>
		<span>
			<UIcon name="i-ph-brackets-curly" />
			{{ t('dms_database.diagram.legend.object') }}
		</span>
		<span>
			<UIcon name="i-ph-lock-key" />
			{{ t('dms_database.modifiers.encrypted') }}
		</span>
	</div>
</template>

<style scoped>
.diagram-legend {
	display: flex;
	gap: 12px;
	padding: 6px 10px;
	border: 1px solid var(--ui-border);
	border-radius: calc(var(--ui-radius) * 0.75);
	background: color-mix(in srgb, var(--ui-bg-elevated) 88%, transparent);
	font: 500 11px var(--font-mono, ui-monospace, monospace);
	color: var(--ui-text-muted);
}
.diagram-legend span {
	display: inline-flex;
	align-items: center;
	gap: 5px;
}
/* Below md the legend and the overview give their room to the canvas. */
@media (max-width: 767.98px) {
	.diagram-legend {
		display: none;
	}
}
</style>
