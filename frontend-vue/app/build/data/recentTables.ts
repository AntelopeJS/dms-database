import { isRecord, isText } from '../utils/values'

/** A table opened lately on a database, offered by the data browser's first-visit state; kept in this browser only. */
export interface RecentTable {
	schema: string
	instance: string
	table: string
	openedAt: string
}

function isRecentTable(value: unknown): value is RecentTable {
	return (
		isRecord(value) &&
		isText(value.schema) &&
		isText(value.table) &&
		isText(value.instance) &&
		isText(value.openedAt)
	)
}

const STORAGE_PREFIX = 'dms-database:data-browser:recent:'
const MAX_RECENT = 5

/** The tables opened lately on `database`, newest first. */
export function readRecentTables(database: string): RecentTable[] {
	if (typeof window === 'undefined') return []
	try {
		const parsed: unknown = JSON.parse(
			window.localStorage.getItem(STORAGE_PREFIX + database) ?? '[]',
		)
		return Array.isArray(parsed) ? parsed.filter(isRecentTable) : []
	} catch {
		return []
	}
}

/** Records a table opened on `database` as its newest. */
export function rememberTable(
	database: string,
	entry: Omit<RecentTable, 'openedAt'>,
): void {
	if (typeof window === 'undefined') return
	const others = readRecentTables(database).filter(
		(recent) =>
			recent.schema !== entry.schema ||
			recent.table !== entry.table ||
			recent.instance !== entry.instance,
	)
	const next = [
		{ ...entry, openedAt: new Date().toISOString() },
		...others,
	].slice(0, MAX_RECENT)
	try {
		window.localStorage.setItem(STORAGE_PREFIX + database, JSON.stringify(next))
	} catch {
		return
	}
}
