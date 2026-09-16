import {
  CROSS_INSTANCE,
  type InstanceId,
} from "@antelopejs/interface-database";
import { CROSS_INSTANCE_SENTINEL } from "../types/constants";

const FILTER_MODE_SEPARATOR = ":";
const FILTER_MODE_IS = "is";
const FILTER_MODE_CONTAINS = "contains";

export interface ParsedFilter {
  mode: string;
  value: string;
}

export function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length === 0) return undefined;
  return value;
}

export function parseInteger(value: unknown, fallback: number): number {
  const text = asNonEmptyString(value);
  if (!text) return fallback;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseFilter(raw: unknown): ParsedFilter | undefined {
  const text = asNonEmptyString(raw);
  if (!text) return undefined;
  const idx = text.indexOf(FILTER_MODE_SEPARATOR);
  if (idx < 0) return { mode: FILTER_MODE_IS, value: text };
  return { mode: text.slice(0, idx), value: text.slice(idx + 1) };
}

export function unwrapIsFilter(raw: unknown): string | undefined {
  const parsed = parseFilter(raw);
  if (!parsed || parsed.mode !== FILTER_MODE_IS) return undefined;
  return parsed.value;
}

// Decode an `is:`-mode instance selection filter the way every browse-style
// endpoint understands it: absent/empty → default instance, the cross-instance
// sentinel → CROSS_INSTANCE, anything else → the named instance id.
export function decodeInstanceFilter(raw: unknown): InstanceId | undefined {
  const value = unwrapIsFilter(raw);
  if (value === undefined || value === null || value === "") return undefined;
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
  rawFilter: unknown,
): T[] {
  const parsed = parseFilter(rawFilter);
  if (!parsed) return rows;
  const predicate = FILTER_PREDICATES[parsed.mode];
  if (!predicate) return rows;
  return rows.filter((row) =>
    predicate(String(row[field] ?? ""), parsed.value),
  );
}

export function applySearchToList<T>(
  rows: T[],
  field: keyof T,
  search: unknown,
): T[] {
  const needle = asNonEmptyString(search)?.toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    cellToText(row[field]).toLowerCase().includes(needle),
  );
}

// Cells hold arbitrary JSON. `String()` on an object yields "[object Object]",
// which sorts every object cell as equal; the JSON form keeps the content.
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  }
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // A cycle or a BigInt. This runs per cell on a browse request, which has no
    // catch of its own, and `String()` never threw -- so it falls through
    // rather than answering a search with a 500.
  }
  try {
    // oxlint-disable-next-line typescript/no-base-to-string
    return String(value);
  } catch {
    // A stored cell can carry a non-callable `toString` -- the browser is
    // schemaless and says so -- which makes even this throw.
    return "";
  }
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return cellToText(a).localeCompare(cellToText(b));
}

export function applySortToList<T>(
  rows: T[],
  sortKey: unknown,
  sortDirection: unknown,
): T[] {
  const key = asNonEmptyString(sortKey);
  if (!key) return rows;
  const direction = asNonEmptyString(sortDirection) === "desc" ? -1 : 1;
  return [...rows].sort(
    (a, b) => compareValues(a[key as keyof T], b[key as keyof T]) * direction,
  );
}

const SORT_DIRECTION_DESC = "desc";
export type SortDirection = "asc" | "desc";

export function normalizeSortDirection(value: unknown): SortDirection {
  return asNonEmptyString(value) === SORT_DIRECTION_DESC ? "desc" : "asc";
}
