const MINUTE_MS = 60_000
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

// Human "3 minutes ago" style label for an ISO timestamp, relative to now, in
// the interface language. Not named `formatRelativeTime`: the DMS core layer
// auto-imports a helper of that name, and the two would shadow each other.
export function formatDatabaseRelativeTime(
	iso: string,
	locale?: string,
): string {
	const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
	const minutes = Math.round((new Date(iso).getTime() - Date.now()) / MINUTE_MS)
	if (Math.abs(minutes) < MINUTES_PER_HOUR)
		return formatter.format(minutes, 'minute')
	const hours = Math.round(minutes / MINUTES_PER_HOUR)
	if (Math.abs(hours) < HOURS_PER_DAY) return formatter.format(hours, 'hour')
	return formatter.format(Math.round(hours / HOURS_PER_DAY), 'day')
}
