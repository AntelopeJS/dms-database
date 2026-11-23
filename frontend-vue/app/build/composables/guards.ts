/** Whether a value is a string. */
export function isText(value: unknown): value is string {
	return typeof value === 'string'
}

/** Whether a value is an object rather than null or a primitive. */
export function isObjectLike(value: unknown): value is object {
	return typeof value === 'object' && value !== null
}
