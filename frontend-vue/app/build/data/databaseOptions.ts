import {
	OWN_CONNECTION,
	isBrowsable,
	type DatabaseConnection,
	type MissingBinding,
} from '../composables/useDatabaseConnections'

/** Translates a message key of the module, with its parameters. */
export type Translate = (key: string, params?: Record<string, string>) => string

/** The small tag after a database's name: what the project lets the console do on it, or why it cannot be browsed. */
export interface DatabaseBadge {
	label: string
	tone: 'neutral' | 'primary' | 'warning'
}

/** One row of the database switcher, as it is drawn. */
export interface DatabaseOption {
	id: string
	name: string
	subtitle: string
	icon: string
	external: boolean
	current: boolean
	badge: DatabaseBadge | null
	/** Why the row cannot be picked; null when it can. */
	unavailable: string | null
}

const KEYS = 'dms_database.connections'
const OWN_ICON = 'i-ph-database'
const EXTERNAL_ICON = 'i-ph-plugs-connected'

/** The icon standing for a database: the project's own, or an external one. */
export function iconOf(connection: DatabaseConnection | undefined): string {
	return connection?.kind === 'external' ? EXTERNAL_ICON : OWN_ICON
}

/** The name a database goes by: the project's own is named from the locale, the others by their label. */
export function nameOf(connection: DatabaseConnection, t: Translate): string {
	return connection.id === OWN_CONNECTION ? t(`${KEYS}.own`) : connection.label
}

/** What a database is: its engine, or what stands in for it when the catalog did not say. */
export function subtitleOf(
	connection: DatabaseConnection,
	t: Translate,
): string {
	if (connection.engine) return connection.engine
	return connection.kind === 'own'
		? t(`${KEYS}.switcher.own_subtitle`)
		: t(`${KEYS}.engine_unknown`)
}

function missingNames(missing: MissingBinding[], t: Translate): string {
	return missing
		.map((binding) => t(`${KEYS}.switcher.missing_${binding}`))
		.join(', ')
}

function badgeOf(
	connection: DatabaseConnection,
	t: Translate,
): DatabaseBadge | null {
	if (connection.kind === 'own') return null
	if (!isBrowsable(connection))
		return { label: t(`${KEYS}.switcher.unregistered`), tone: 'warning' }
	return connection.access === 'read-write'
		? { label: t(`${KEYS}.switcher.access_read_write`), tone: 'primary' }
		: { label: t(`${KEYS}.switcher.access_read`), tone: 'neutral' }
}

/**
 * The rows of the switcher for the connections the console lists.
 *
 * @param connections The connections, the project's own first
 * @param selectedId The connection the user browses
 * @param t Translates a message key
 */
export function databaseOptions(
	connections: readonly DatabaseConnection[],
	selectedId: string | undefined,
	t: Translate,
): DatabaseOption[] {
	return connections.map((connection) => ({
		id: connection.id,
		name: nameOf(connection, t),
		subtitle: subtitleOf(connection, t),
		icon: iconOf(connection),
		external: connection.kind === 'external',
		current: connection.id === selectedId,
		badge: badgeOf(connection, t),
		unavailable: isBrowsable(connection)
			? null
			: t(`${KEYS}.switcher.unregistered_hint`, {
					name: nameOf(connection, t),
					missing: missingNames(connection.missing, t),
				}),
	}))
}

/**
 * The row a key moves the focus to in a list, or nothing for a key that does not move it.
 *
 * @param current The index of the focused row, -1 when none is
 * @param count How many rows the list has
 * @param key The key pressed
 */
export function focusTarget(
	current: number,
	count: number,
	key: string,
): number | undefined {
	if (count === 0) return undefined
	switch (key) {
		case 'ArrowDown':
			return current < 0 ? 0 : (current + 1) % count
		case 'ArrowUp':
			return current <= 0 ? count - 1 : current - 1
		case 'Home':
			return 0
		case 'End':
			return count - 1
		default:
			return undefined
	}
}
