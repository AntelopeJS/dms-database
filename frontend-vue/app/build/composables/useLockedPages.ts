import type { Ref } from 'vue'
import {
	lacksFeature,
	type ConnectionFeature,
	type DatabaseConnection,
} from './useDatabaseConnections'

/** The module's pages an external database cannot serve, by the feature each needs. */
const LOCKABLE_PAGES: ReadonlyArray<{
	path: string
	feature: ConnectionFeature
}> = [
	{ path: '/modules/database/diagram', feature: 'diagram' },
	{ path: '/modules/database/query', feature: 'queryConsole' },
]

const LOCK_REASON = '$dms_database.connections.locked.reason'

/**
 * Keeps the sidebar entries of the pages the selected database cannot serve
 * locked, with the reason as their tooltip, and unlocks them once it can.
 * The lock closes the entry only: each page shows its own locked state for a
 * direct URL.
 *
 * @param selected The connection this user browses
 */
export function useLockedPages(selected: Ref<DatabaseConnection | undefined>) {
	const siteLayout = useSiteLayout()
	const { lock, unlock } = useMenuLocks()
	const pages = computed(() =>
		LOCKABLE_PAGES.flatMap((page) => {
			const fullId = siteLayout.findMatchingRoute(page.path)?.metadata.fullId
			return fullId
				? [{ fullId, locked: lacksFeature(selected.value, page.feature) }]
				: []
		}),
	)
	watch(
		pages,
		(entries) => {
			for (const { fullId, locked } of entries) {
				if (locked) lock({ fullId, reason: LOCK_REASON })
				else unlock(fullId)
			}
		},
		{ immediate: true },
	)
}
