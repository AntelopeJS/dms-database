/** A cell as the backend stores it and a request body carries it: JSON data, or undefined for an empty one. */
export type CellValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| CellValue[]
	| { [key: string]: CellValue }

/** A row of a table: its cells by column. */
export type CellRow = Record<string, CellValue>

/** Whether a value is text. */
export function isText(value: unknown): value is string {
	return typeof value === 'string'
}

/** Whether a value is a number. */
export function isNumber(value: unknown): value is number {
	return typeof value === 'number'
}

/** Whether a value is a boolean. */
export function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean'
}

/** Whether a value is null, text, a number or a boolean: JSON data that holds no other value. */
export function isScalar(
	value: unknown,
): value is string | number | boolean | null {
	return value === null || isText(value) || isNumber(value) || isBoolean(value)
}

/** Whether a value is an object or a list: something that holds other values. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isCellValueAt(value: unknown, path: Set<object>): value is CellValue {
	if (value === undefined || isScalar(value)) return true
	if (!isRecord(value) || path.has(value)) return false
	const prototype: unknown = Object.getPrototypeOf(value)
	const plain =
		Array.isArray(value) || prototype === Object.prototype || prototype === null
	if (!plain) return false
	path.add(value)
	const members: unknown[] = Array.isArray(value) ? value : Object.values(value)
	const holds = members.every((member) => isCellValueAt(member, path))
	path.delete(value)
	return holds
}

/** Whether a value is JSON data all the way down: plain objects and lists of cell values, none holding itself. */
export function isCellValue(value: unknown): value is CellValue {
	return isCellValueAt(value, new Set())
}
