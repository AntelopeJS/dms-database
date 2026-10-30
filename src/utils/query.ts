import {
  CROSS_INSTANCE,
  type InstanceId,
} from "@antelopejs/interface-database";
import { CROSS_INSTANCE_SENTINEL } from "../types/constants";
import { isBoolean, isNumber, isString } from "./guards";

const FILTER_MODE_SEPARATOR = ":";
const FILTER_MODE_IS = "is";
const FILTER_MODE_CONTAINS = "contains";

export interface ParsedFilter {
  mode: string;
  value: string;
}

export function parseInteger(
  text: string | undefined,
  fallback: number,
): number {
  if (!text) return fallback;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseFilter(
  text: string | undefined,
): ParsedFilter | undefined {
  if (!text) return undefined;
  const idx = text.indexOf(FILTER_MODE_SEPARATOR);
  if (idx < 0) return { mode: FILTER_MODE_IS, value: text };
  return { mode: text.slice(0, idx), value: text.slice(idx + 1) };
}

export function unwrapIsFilter(text: string | undefined): string | undefined {
  const parsed = parseFilter(text);
  if (!parsed || parsed.mode !== FILTER_MODE_IS) return undefined;
  return parsed.value;
}

/**
 * Decode an `is:`-mode instance selection filter the way every browse-style
 * endpoint understands it: absent/empty → default instance, the cross-instance
 * sentinel → CROSS_INSTANCE, anything else → the named instance id.
 */
export function decodeInstanceFilter(
  text: string | undefined,
): InstanceId | undefined {
  const value = unwrapIsFilter(text);
  if (value === undefined || value === "") return undefined;
  if (value === CROSS_INSTANCE_SENTINEL) return CROSS_INSTANCE;
  return value;
}

const FILTER_PREDICATES: Record<
  string,
  (cell: string, value: string) => boolean
> = {
  [FILTER_MODE_IS]: (cell, value) => cell === value,
  [FILTER_MODE_CONTAINS]: (cell, value) =>
    cell.toLowerCase().includes(value.toLowerCase()),
};

export function applyFilterToList<T>(
  rows: T[],
  field: keyof T,
  rawFilter: string,
): T[] {
  const parsed = parseFilter(rawFilter);
  if (!parsed) return rows;
  const predicate = FILTER_PREDICATES[parsed.mode];
  if (!predicate) return rows;
  return rows.filter((row) =>
    predicate(String(row[field] ?? ""), parsed.value),
  );
}

/**
 * Cells hold arbitrary JSON. `String()` on an object yields "[object Object]",
 * which sorts every object cell as equal; the JSON form keeps the content. A
 * cycle or a BigInt falls through to `String()`: this runs per cell on a
 * browse request, which has no catch of its own, and `String()` never threw,
 * so a search is not answered with a 500. A stored cell can carry a
 * non-callable `toString` (the browser is schemaless), which makes even that
 * throw: the cell then reads as empty.
 */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isString(value)) return value;
  if (isNumber(value) || isBoolean(value)) return value.toString();
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {}
  try {
    // oxlint-disable-next-line typescript/no-base-to-string -- the cell is arbitrary JSON from a schemaless store, and the catch below handles a toString that throws
    return String(value);
  } catch {
    return "";
  }
}

const SORT_DIRECTION_DESC = "desc";
export type SortDirection = "asc" | "desc";

export function normalizeSortDirection(
  text: string | undefined,
): SortDirection {
  return text === SORT_DIRECTION_DESC ? "desc" : "asc";
}
