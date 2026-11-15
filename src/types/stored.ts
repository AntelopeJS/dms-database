/** The stored row as a table of its own columns: a column may be named like an `Object.prototype` member. */
export type StoredRow = ReadonlyMap<string, unknown>;

/** One cell of a stored row, whatever the store holds there: a schemaless table types none of them. */
export type StoredCell = ReturnType<StoredRow["get"]>;
