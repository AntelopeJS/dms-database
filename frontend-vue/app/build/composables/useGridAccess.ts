import { useDatabaseConnections } from './useDatabaseConnections'
import { CROSS_INSTANCE_VALUE, type BrowserTab } from './useDataBrowserTabs'

/**
 * What a grid may do, by its tab's instance and the database browsed: the
 * cross-instance union and an external database left on read take no edit,
 * and an external database offers no instance, row reference or query console.
 */
export function useGridAccess(tab: () => BrowserTab) {
	const { refusesEdits, lacks } = useDatabaseConnections()
	const crossInstance = computed(() => tab().instance === CROSS_INSTANCE_VALUE)
	const readOnly = computed(() => crossInstance.value || refusesEdits.value)

	return {
		crossInstance,
		readOnly,
		showReferences: computed(
			() => !crossInstance.value && !lacks('rowReferences'),
		),
		canOpenQuery: computed(() => !lacks('queryConsole')),
		canSearchAllInstances: computed(
			() => !readOnly.value && !lacks('instances'),
		),
	}
}
