<script setup lang="ts">
defineProps<{ title: string }>()

const { t } = useI18n()
</script>

<template>
	<div class="grid flex-1 place-items-center p-6" data-feature-locked>
		<DmsEmptyState
			icon="i-ph-lock"
			:title="title"
			:description="t('dms_database.connections.locked.reason')"
		/>
	</div>
</template>
