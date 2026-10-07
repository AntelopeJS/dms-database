// The tables opened lately, offered by the data browser's first-visit state
// (D-15). Kept in this browser only.

export interface RecentTable {
	schema: string;
	instance: string;
	table: string;
	openedAt: string;
}

const STORAGE_KEY = "dms-database:data-browser:recent";
const MAX_RECENT = 5;

export function readRecentTables(): RecentTable[] {
	if (typeof window === "undefined") return [];
	try {
		const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
		return Array.isArray(parsed)
			? parsed.filter(
					(entry): entry is RecentTable =>
						typeof entry?.schema === "string" &&
						typeof entry?.table === "string" &&
						typeof entry?.instance === "string",
				)
			: [];
	} catch {
		return [];
	}
}

export function rememberTable(entry: Omit<RecentTable, "openedAt">) {
	if (typeof window === "undefined") return;
	const others = readRecentTables().filter(
		(recent) =>
			recent.schema !== entry.schema ||
			recent.table !== entry.table ||
			recent.instance !== entry.instance,
	);
	const next = [{ ...entry, openedAt: new Date().toISOString() }, ...others].slice(0, MAX_RECENT);
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		// A full or private storage only loses the suggestions.
	}
}
