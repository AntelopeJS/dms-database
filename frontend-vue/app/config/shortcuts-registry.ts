// The module's keyboard shortcuts, listed on the dashboard's Shortcuts
// settings page (D-17); the components bind them themselves.

interface ShortcutMetadata {
	key: string[]
	descriptionKey: string
	component: string
}

interface ComponentShortcuts {
	component: string
	shortcuts: ShortcutMetadata[]
}

const META = '$keyboard.meta'
const SHIFT = '$keyboard.shift'

function group(
	component: string,
	entries: [string[], string][],
): ComponentShortcuts {
	return {
		component,
		shortcuts: entries.map(([key, description]) => ({
			key,
			descriptionKey: `$dms_database.shortcuts.${description}`,
			component,
		})),
	}
}

export default [
	group('$dms_database.shortcuts.data_browser', [
		[['T'], 'find_table'],
		[[META, '/'], 'search_rows'],
		[['R'], 'refresh'],
		[['$keyboard.enter'], 'edit_cell'],
		[['$keyboard.space'], 'open_row'],
		[['J'], 'next_row'],
		[['K'], 'previous_row'],
		[[META, 'S'], 'review_save'],
	]),
	group('$dms_database.shortcuts.schemas', [
		[['/'], 'find_table_or_column'],
		[['J'], 'next_table'],
		[['K'], 'previous_table'],
	]),
	group('$dms_database.shortcuts.diagram', [
		[['F'], 'find_table'],
		[['N'], 'add_note'],
		[['V'], 'select'],
		[['H'], 'pan'],
		[['1'], 'fit'],
		[['0'], 'reset_zoom'],
		[[META, 'Z'], 'undo'],
		[[META, SHIFT, 'Z'], 'redo'],
		[[META, 'Y'], 'redo'],
		[['$keyboard.escape'], 'step_back'],
	]),
	group('$dms_database.shortcuts.query_console', [
		[[META, '$keyboard.enter'], 'run'],
		[[META, 'S'], 'save'],
		[['Ctrl', '$keyboard.space'], 'complete'],
	]),
] satisfies ComponentShortcuts[]
