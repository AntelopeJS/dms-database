import type { InjectionKey, Ref } from 'vue'
import {
	refusesEdits,
	useDatabaseConnections,
} from '../composables/useDatabaseConnections'

/**
 * Why the grid's cells take no edit, which each cell shows where the user
 * tries one: set while the selected external database is read only, absent
 * otherwise.
 */
export const READ_ONLY_REASON: InjectionKey<Ref<string | null>> = Symbol(
	'dms-database:read-only-reason',
)

/** Gives the cells below the reason the selected database refuses edits. */
export function provideReadOnlyReason(): void {
	const { t } = useI18n()
	const { selected } = useDatabaseConnections()
	provide(
		READ_ONLY_REASON,
		computed(() =>
			selected.value && refusesEdits(selected.value)
				? t('dms_database.data.save.read_only_access', {
						connection: selected.value.label,
					})
				: null,
		),
	)
}
