const relativeFormatter = new Intl.RelativeTimeFormat(undefined, {
	numeric: "auto",
});

// Human "3 minutes ago" style label for an ISO timestamp, relative to now.
// Shared by the query history and favorites panels.
// Deliberately not named `formatRelativeTime`: the DMS core layer exports a
// translation-aware helper under that name, and auto-imports across layers
// would shadow one with the other.
export function formatDatabaseRelativeTime(iso: string): string {
	const diffMs = new Date(iso).getTime() - Date.now();
	const minutes = Math.round(diffMs / 60_000);
	if (Math.abs(minutes) < 60) return relativeFormatter.format(minutes, "minute");
	const hours = Math.round(minutes / 60);
	if (Math.abs(hours) < 24) return relativeFormatter.format(hours, "hour");
	const days = Math.round(hours / 24);
	return relativeFormatter.format(days, "day");
}
