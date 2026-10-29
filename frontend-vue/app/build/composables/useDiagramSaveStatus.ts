import { useNow } from '@vueuse/core'
import { type SaveStatus } from '../diagram/autosave'
import type { DiagramSync } from '../diagram/sync'

const MINUTE_MS = 60_000

/**
 * What the save bar says of the layout's autosave: the status of the schema
 * shown, and a failure of one left before its save ended.
 */
export function useDiagramSaveStatus(shown: () => DiagramSync | null) {
	const { t } = useI18n()
	const toast = useToast()
	const now = useNow({ interval: MINUTE_MS / 2 })
	const saveState = ref<SaveStatus>('idle')
	const savedAt = ref<Date | null>(null)

	/** Shows the save status of the schema shown; a schema left reports a failure. */
	function statusReporter(owner: DiagramSync) {
		return (status: SaveStatus) => {
			if (owner === shown()) {
				saveState.value = status
				if (status === 'saved') savedAt.value = new Date()
				return
			}
			// The save of a schema left before it ended.
			if (status === 'error') {
				toast.add({
					title: t('dms_database.diagram.save.error_other', {
						schema: owner.schemaId,
					}),
					color: 'error',
					icon: 'i-ph-warning-circle',
				})
			}
		}
	}

	const savedLabel = computed(() => {
		if (saveState.value === 'saving')
			return t('dms_database.diagram.save.saving')
		if (saveState.value === 'error') return t('dms_database.diagram.save.error')
		if (!savedAt.value) return t('dms_database.diagram.save.idle')
		const minutes = Math.round(
			(now.value.getTime() - savedAt.value.getTime()) / MINUTE_MS,
		)
		return minutes < 1
			? t('dms_database.diagram.save.just_now')
			: t('dms_database.diagram.save.minutes', { count: minutes })
	})

	return { saveState, savedAt, savedLabel, statusReporter }
}
