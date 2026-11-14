import { forgetBrowserTabs } from './useDataBrowserTabs'

/**
 * Reloads the page on the database the server now serves, once another tab
 * switched it: the tabs this tab kept belong to the one it showed, and so
 * does the table its URL names.
 */
export function reloadForSelection(): void {
	forgetBrowserTabs()
	window.location.assign(window.location.pathname)
}
