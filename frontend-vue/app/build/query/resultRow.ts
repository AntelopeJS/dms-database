/** A value as the query routes return it: JSON. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue }

/** One row of a query result: its columns by name. */
export type ResultRow = Record<string, JsonValue>
