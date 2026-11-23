/** Whether a value is a non-null object, an array included. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/** Whether a value is an object, an array included. */
export function isObject(value: unknown): value is object {
	return typeof value === 'object' && value !== null
}

/** Whether a value is a string. */
export function isString(value: unknown): value is string {
	return typeof value === 'string'
}

/** Whether a value is a number. */
export function isNumber(value: unknown): value is number {
	return typeof value === 'number'
}

/** Whether a value is a symbol. */
export function isSymbol(value: unknown): value is symbol {
	return typeof value === 'symbol'
}
