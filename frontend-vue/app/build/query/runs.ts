import type { HistoryEntry } from "../../composables/useQueryStore";

// How the library tells runs apart (D-11): a dot per run — fast, slow,
// failed or changed data — and day headings.

export type RunKind = "fast" | "slow" | "failed" | "changed";

// A run slower than this, in milliseconds, is slow; the server flags the
// recent queries of the overview with the same threshold.
export const SLOW_QUERY_MS = 100;

export function runKind(entry: HistoryEntry): RunKind {
	if (entry.status === "error") return "failed";
	if (entry.mutation) return "changed";
	return entry.durationMs > SLOW_QUERY_MS ? "slow" : "fast";
}

export const RUN_DOT_CLASSES: Record<RunKind, string> = {
	fast: "bg-success",
	slow: "bg-warning",
	failed: "bg-error",
	changed: "bg-info",
};

export interface DayGroup<T> {
	key: string;
	date: Date;
	items: T[];
}

function dayKey(date: Date): string {
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Entries by local calendar day, newest day first, in their given order. */
export function groupByDay<T>(entries: T[], dateOf: (entry: T) => string): DayGroup<T>[] {
	const groups = new Map<string, DayGroup<T>>();
	for (const entry of entries) {
		const date = new Date(dateOf(entry));
		const key = dayKey(date);
		const group = groups.get(key) ?? { key, date, items: [] };
		group.items.push(entry);
		groups.set(key, group);
	}
	return [...groups.values()];
}

const DAY_MS = 86_400_000;

/** "Today", "Yesterday" or the date, in the interface language. */
export function dayLabel(date: Date, locale: string, words: { today: string; yesterday: string }): string {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const day = new Date(date);
	day.setHours(0, 0, 0, 0);
	const days = Math.round((today.getTime() - day.getTime()) / DAY_MS);
	if (days === 0) return words.today;
	if (days === 1) return words.yesterday;
	return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date);
}

/** The table named by an "Unknown table" error, if the message names one. */
export function unknownTable(message: string): string | null {
	return /unknown table:?\s*["“']?([\w$-]+)/i.exec(message)?.[1] ?? null;
}

function distance(left: string, right: string): number {
	const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let i = 1; i <= left.length; i += 1) {
		let diagonal = previous[0] as number;
		previous[0] = i;
		for (let j = 1; j <= right.length; j += 1) {
			const above = previous[j] as number;
			const cost = left[i - 1] === right[j - 1] ? 0 : 1;
			previous[j] = Math.min(above + 1, (previous[j - 1] as number) + 1, diagonal + cost);
			diagonal = above;
		}
	}
	return previous[right.length] as number;
}

// Two edits away at most: "invoice" for "invoices", "oders" for "orders".
const MAX_SUGGESTION_DISTANCE = 2;

/** The table name closest to a mistyped one, when one is close enough. */
export function closestTable(name: string, tables: string[]): string | null {
	let best: string | null = null;
	let bestDistance = MAX_SUGGESTION_DISTANCE + 1;
	for (const table of tables) {
		const score = distance(name.toLowerCase(), table.toLowerCase());
		if (score < bestDistance) {
			best = table;
			bestDistance = score;
		}
	}
	return best;
}
