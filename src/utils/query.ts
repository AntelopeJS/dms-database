import {
  CROSS_INSTANCE,
  type InstanceId,
} from "@antelopejs/interface-database";
import { CROSS_INSTANCE_SENTINEL } from "../types/constants";
import {
  isBigInt,
  isBoolean,
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from "./guards";

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

const FILTER_PREDICATES = new Map([
  [FILTER_MODE_IS, (cell: string, value: string) => cell === value],
  [
    FILTER_MODE_CONTAINS,
    (cell: string, value: string) =>
      cell.toLowerCase().includes(value.toLowerCase()),
  ],
]);

export function applyFilterToList<T extends object>(
  rows: T[],
  field: string,
  rawFilter: string,
): T[] {
  const parsed = parseFilter(rawFilter);
  if (!parsed) return rows;
  const predicate = FILTER_PREDICATES.get(parsed.mode);
  if (!predicate) return rows;
  return rows.filter((row) =>
    predicate(
      String(Object.getOwnPropertyDescriptor(row, field)?.value ?? ""),
      parsed.value,
    ),
  );
}

/**
 * Cells hold arbitrary JSON. `String()` on an object yields "[object Object]",
 * which makes every object cell match the same search and compare as equal;
 * the JSON form keeps the content. A bigint, a symbol or a function, which
 * JSON does not encode, reads as its own `toString()`. An object JSON cannot
 * encode (a cycle, a nested bigint, a `toJSON` that throws or gives nothing)
 * reads as empty, as does a function whose `toString` throws: this runs per
 * cell on a browse request, which has no catch of its own, so a search is not
 * answered with a 500.
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
    if (isBigInt(value) || isSymbol(value) || isFunction(value)) {
      return value.toString();
    }
  } catch {}
  return "";
}

const SORT_DIRECTION_DESC = "desc";
export type SortDirection = "asc" | "desc";

export function normalizeSortDirection(
  text: string | undefined,
): SortDirection {
  return text === SORT_DIRECTION_DESC ? "desc" : "asc";
}
