/**
 * The module's own id and the switcher's registered name: the sidebar mounts
 * the widget by that name, under the title card of this module only.
 */
export const DATABASE_SWITCHER_WIDGET = {
	id: 'dms-database:switcher',
	component: 'DmsDatabaseDatabaseSwitcher',
	module: 'database',
	position: 'below-search-bar',
	order: -100,
} satisfies SidebarWidget

/** Puts the database switcher in the sidebar, at the top of the module's. */
export function registerDatabaseSwitcher(): void {
	useSidebarWidgets().register(DATABASE_SWITCHER_WIDGET)
}
