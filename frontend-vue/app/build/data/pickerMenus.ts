import type { InstanceChoice } from './instanceOptions'
import { matchNames } from './instanceOptions'

// The menus of the schema and instance pickers (SchemaPicker.vue,
// InstancePicker.vue), shared by the Schemas page's filter bar and the data
// browser's sidebar: what is pinned, the names a search found, and the note
// under them (loading, failed, more than shown).

export interface PickerItem {
	label: string
	value?: string
	icon?: string
	description?: string
	class?: string
	type?: 'label'
}

// Menu values standing for no schema or instance in particular: a NUL never
// appears in a name.
export const PICK_ALL = '\u0000all'
export const PICK_DEFAULT = '\u0000default'

// A group holding a `.pin-top` item sticks to the top of the list while it
// scrolls; notes read as plain text.
export const PICKER_MENU_UI = {
	viewport: 'scroll-pt-10 scroll-pb-14',
	label: 'font-sans text-xs font-normal normal-case tracking-normal text-muted',
	group:
		'bg-default has-[.pin-top]:sticky has-[.pin-top]:top-0 has-[.pin-top]:z-10',
}

export const SCHEMA_ICON = 'i-ph-stack'
export const ALL_ICON = 'i-ph-stack-simple'
export const INSTANCE_ICON = 'i-ph-cube'
export const READ_ONLY_ICON = 'i-ph-lock-simple'

/**
 * How a picker offers every instance: as a filter ("filter"), or as the data
 * browser's read-only cross-instance view ("readonly").
 */
export type AllInstancesMode = 'filter' | 'readonly'

function matching(label: string, needle: string): boolean {
	return !needle || label.toLowerCase().includes(needle)
}

function groups(...lists: PickerItem[][]): PickerItem[][] {
	return lists.filter((group) => group.length > 0)
}

interface SchemaMenu {
	/** Schema ids, sorted. */
	ids: readonly string[]
	search: string
	/** "All schemas", pinned first; null when a schema must be picked. */
	allLabel: string | null
	more: (shown: number, total: number) => string
}

export function schemaMenu(menu: SchemaMenu): PickerItem[][] {
	const needle = menu.search.trim().toLowerCase()
	const pinned: PickerItem[] =
		menu.allLabel !== null && matching(menu.allLabel, needle)
			? [
					{
						label: menu.allLabel,
						value: PICK_ALL,
						icon: ALL_ICON,
						class: 'pin-top',
					},
				]
			: []
	const { shown, total } = matchNames(menu.ids, menu.search)
	const named: PickerItem[] = shown.map((id) => ({
		label: id,
		value: id,
		icon: SCHEMA_ICON,
	}))
	if (total > shown.length)
		named.push({ label: menu.more(shown.length, total), type: 'label' })
	return groups(pinned, named)
}

export type InstancesStatus = 'idle' | 'pending' | 'success' | 'error'

interface InstanceMenuLabels {
	all: string
	/** Under "all" in the read-only mode. */
	readOnly: string
	default: string
	pickSchema: string
	loading: string
	failed: string
	noNamed: string
	noMatch: string
	more: (shown: number, total: number) => string
	count: (value: number) => string
}

export interface InstanceMenu {
	search: string
	/** A schema is picked: its named instances can be listed. */
	hasSchema: boolean
	/** Named instances the search found, at most the picker's limit. */
	names: readonly string[]
	/** Named instances matching the search. */
	matched: number
	/** Named instances of the schema, before any search; null until known. */
	total: number | null
	status: InstancesStatus
	allMode: AllInstancesMode
	labels: InstanceMenuLabels
}

export function instanceMenu(menu: InstanceMenu): PickerItem[][] {
	const { labels } = menu
	const needle = menu.search.trim().toLowerCase()
	const readOnly = menu.allMode === 'readonly'
	// Every instance: the default one and the named ones. The read-only view
	// is offered whatever the search, as it also reads rows of instances never
	// registered; the filter matches the search.
	const all: PickerItem[] =
		readOnly || matching(labels.all, needle)
			? [
					{
						label:
							menu.total === null
								? labels.all
								: `${labels.all} (${labels.count(menu.total + 1)})`,
						value: PICK_ALL,
						icon: readOnly ? READ_ONLY_ICON : ALL_ICON,
						...(readOnly ? { description: labels.readOnly } : {}),
						...(needle ? {} : { class: 'pin-top' }),
					},
				]
			: []
	const defaultShown = matching(labels.default, needle)
	const pinned: PickerItem[] = defaultShown
		? [{ label: labels.default, value: PICK_DEFAULT, icon: INSTANCE_ICON }]
		: []
	// Without a search "all" comes first, pinned; while one is typed it comes
	// after the matches, so that Enter picks the first match.
	if (!needle) pinned.unshift(...all)
	const last = needle ? all : []
	if (!menu.hasSchema)
		return groups(pinned, [{ label: labels.pickSchema, type: 'label' }], last)
	const named: PickerItem[] = menu.names.map((id) => ({
		label: id,
		value: id,
		icon: INSTANCE_ICON,
	}))
	let note: string | null = null
	if (menu.status === 'error') note = labels.failed
	else if (menu.status !== 'success') note = labels.loading
	else if (menu.total === 0 && !needle) note = labels.noNamed
	else if (menu.matched === 0 && !defaultShown) note = labels.noMatch
	else if (menu.matched > named.length)
		note = labels.more(named.length, menu.matched)
	if (note) named.push({ label: note, type: 'label' })
	return groups(pinned, named, last)
}

/** A picker's menu value for an instance choice. */
export function instancePickValue(choice: InstanceChoice): string {
	if (choice.kind === 'all') return PICK_ALL
	if (choice.kind === 'default') return PICK_DEFAULT
	return choice.id
}

/** The instance choice a picker's menu value stands for. */
export function instancePickChoice(value: string): InstanceChoice {
	if (value === PICK_ALL) return { kind: 'all' }
	if (value === PICK_DEFAULT) return { kind: 'default' }
	return { kind: 'named', id: value }
}
