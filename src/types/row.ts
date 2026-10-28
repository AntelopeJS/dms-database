import type { JsonValue } from "./json";

/** A value a cell of a schemaless table holds: JSON, or a date. */
export type CellValue = JsonValue | Date | undefined;

/** One row of a schemaless table, keyed by column. */
export interface Row {
  [column: string]: CellValue;
}
