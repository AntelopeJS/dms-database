<script setup lang="ts">
import type { SaveNotice } from '../data/useStagedSave'

defineProps<{
	pendingCount: number
	changedFields: string[]
	saving: boolean
	notice: SaveNotice | null
}>()

const emit = defineEmits<{
	discard: []
	save: []
	undo: []
}>()

const { t } = useI18n()
</script>

<template>
	<div
		v-if="pendingCount > 0 || notice"
		class="border-default border-t px-3 py-2"
	>
		<DmsSaveBar
			v-if="pendingCount > 0"
			variant="band"
			dirty
			:saving="saving"
			:changes="changedFields"
			:save-label="t('dms_database.data.save.review', pendingCount)"
			@discard="emit('discard')"
			@save="emit('save')"
		/>
		<div
			v-else-if="notice"
			role="status"
			class="flex min-h-9 items-center gap-2 text-[13px]"
		>
			<UIcon
				:name="
					notice.state === 'undone'
						? 'i-ph-arrow-counter-clockwise'
						: 'i-ph-check-circle'
				"
				class="size-4 shrink-0"
				:class="notice.state === 'undone' ? 'text-muted' : 'text-success'"
			/>
			<span class="text-toned truncate">
				{{
					notice.state === 'undone'
						? t('dms_database.data.save.undone', notice.changes.length)
						: t(
								'dms_database.data.save.saved',
								{ scope: notice.scope },
								notice.changes.length,
							)
				}}
			</span>
			<UButton
				v-if="notice.state !== 'undone'"
				class="ms-auto"
				:label="t('dms_database.data.save.undo')"
				icon="i-ph-arrow-counter-clockwise"
				color="neutral"
				variant="outline"
				size="lg"
				:loading="notice.state === 'undoing'"
				@click="emit('undo')"
			/>
		</div>
	</div>
</template>
