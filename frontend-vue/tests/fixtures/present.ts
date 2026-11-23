/** The value a test expects to find, or a failure naming what is missing. */
export function present<T>(value: T | null | undefined, what: string): T {
	if (value === null || value === undefined)
		throw new Error(`expected ${what} to be present`)
	return value
}
