import { forgetRecentTables } from '../data/recentTables'
import { forgetBrowserTabs } from './useDataBrowserTabs'

/**
 * Reloads the page on the database the server now serves, once another tab
 * switched it: the tabs and recent tables this tab kept belong to the one it
 * showed.
 */
export function reloadForSelection(): void {
	forgetBrowserTabs()
	forgetRecentTables()
	window.location.reload()
}
