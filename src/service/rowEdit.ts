import { assert } from "@antelopejs/interface-api-util";
import { isJsonContainer, type JsonValue } from "../types/json";
import { isBoolean, isObject } from "../utils/guards";
import { cellToText } from "../utils/query";

/**
 * Synthetic columns the browse layer surfaces but does not persist (e.g. the
 * instance tag added to cross-instance reads). They must never be written
 * back.
 */
const SYNTHETIC_FIELDS = new Set(["_instance"]);
/**
 * Always-read-only identity columns. `_id` is the conventional immutable
 * primary key; it is protected here even when the table's primary key cannot
 * be resolved (getTablePrimaryKey returns undefined), so a form can never
 * rewrite a row's id.
 */
const READONLY_FIELDS = new Set(["_id"]);

/**
 * `object` is the contract: this round-trips anything non-primitive through
 * JSON.
 */
// oxlint-disable-next-line anti-slop/no-object-parameters -- the call site reaches it with `object` because `isObject(value)` narrows the unknown edit value to `object`; a narrower type here would only push an assertion up
function normalizeJsonValue(value: object): JsonValue | undefined {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

/** Sentinel: the field must not be written (protected, unchanged, or invalid). */
const SKIP_FIELD = Symbol("skip");

/** The stored row as a table of its own columns: a column may be named like an `Object.prototype` member. */
type StoredRow = ReadonlyMap<string, unknown>;

type EditValue = JsonValue | Date | typeof SKIP_FIELD;

/**
 * Fields a write never touches: the primary key, `_id` and the browse-only
 * synthetic columns.
 */
function isProtectedField(field: string, primaryKey: string | undefined) {
  return (
    field === primaryKey ||
    SYNTHETIC_FIELDS.has(field) ||
    READONLY_FIELDS.has(field)
  );
}

/** `null` clears a cell, which is also how an undo restores an empty one. */
function resolveClearedValue(
  current: StoredRow,
  field: string,
): null | typeof SKIP_FIELD {
  const before = current.get(field);
  return before === null || before === undefined ? SKIP_FIELD : null;
}

function resolveStructuredValue(
  current: StoredRow,
  field: string,
  // oxlint-disable-next-line anti-slop/no-object-parameters -- `object` for the same reason as normalizeJsonValue: a JSON-editor cell is any non-null object, and `isObject(value)` narrows the caller's unknown value to exactly that
  value: object,
): JsonValue | typeof SKIP_FIELD {
  const normalized = normalizeJsonValue(value);
  if (!isJsonContainer(normalized)) return SKIP_FIELD;
  const before = current.get(field);
  try {
    if (
      isObject(before) &&
      JSON.stringify(before) === JSON.stringify(normalized)
    )
      return SKIP_FIELD;
  } catch {}
  return normalized;
}

function isWritableScalar(value: unknown): value is string | number | boolean {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" || typeof value === "boolean";
}

/**
 * A date cell takes a date or nothing: a value that is not one is refused
 * (400) rather than dropped, which would answer a save that wrote nothing.
 */
function resolveDateValue(
  field: string,
  before: Date,
  value: string | number | boolean,
) {
  const date = isBoolean(value) ? null : new Date(value);
  assert(
    date && !Number.isNaN(date.getTime()),
    400,
    `Invalid date for '${field}': ${JSON.stringify(value)}`,
  );
  return date.getTime() === before.getTime() ? SKIP_FIELD : date;
}

/**
 * Decide the value to persist for a single edited field, or SKIP_FIELD to drop
 * the write. Dates travel as ISO text: a date cell stays a date. Cells echoed
 * back unchanged are skipped. The string comparison also covers an object cell
 * echoed as its string form by a whole-row client ("1,2" for [1, 2]): dropping
 * that write protects the structured value from an accidental destructive
 * cast, and deliberate structured edits go through the object branch. It
 * compares the client's string form of a cell against the stored value's
 * through cellToText (JSON would defeat it), which also survives a stored cell
 * whose own `toString` is not callable: the browser is schemaless, so a column
 * really can be named `toString`.
 */
function resolveEditValue(
  current: StoredRow,
  field: string,
  value: unknown,
  primaryKey: string | undefined,
): EditValue {
  if (value === undefined || isProtectedField(field, primaryKey)) {
    return SKIP_FIELD;
  }
  if (value === null) return resolveClearedValue(current, field);
  if (isObject(value)) return resolveStructuredValue(current, field, value);
  if (!isWritableScalar(value)) return SKIP_FIELD;
  const before = current.get(field);
  if (before instanceof Date) return resolveDateValue(field, before, value);
  if (
    before !== null &&
    before !== undefined &&
    cellToText(before) === cellToText(value)
  ) {
    return SKIP_FIELD;
  }
  return value;
}

/**
 * Turn a form-submitted edit body (a map of field → new value) into a
 * sanitised update set. The data browser edits one cell at a time, so the body
 * usually holds a single field. Kept out of the update set:
 *   - untouched fields (undefined) and nulls over a cell already empty,
 *   - the read-only primary key,
 *   - synthetic browse-only fields,
 *   - non-finite numbers, and
 *   - cells whose submitted value still equals the stored one (an unchanged
 *     echo).
 *
 * Scalars compare by string form so a numeric cell rendered as text ("42" vs
 * 42) is recognised as unchanged. Structured cells (the JSON editor) are
 * accepted as JSON-serialisable objects/arrays, normalised through a JSON
 * round-trip so dates, class instances and other exotic prototypes cannot
 * sneak into the store; they compare by JSON.stringify. The update set has a
 * null prototype so a field literally named `__proto__` (a column shape the
 * browse layer supports) creates a real own key instead of reparenting the
 * object, which would silently drop the edit while reporting success.
 */
export function buildEditUpdates(
  current: Record<string, unknown>,
  body: Record<string, unknown>,
  primaryKey: string | undefined,
): Record<string, JsonValue | Date> {
  const stored = new Map(Object.entries(current));
  const updates = Object.fromEntries(
    Object.entries(body).flatMap(([field, value]) => {
      const resolved = resolveEditValue(stored, field, value, primaryKey);
      return resolved === SKIP_FIELD ? [] : [[field, resolved]];
    }),
  );
  Reflect.setPrototypeOf(updates, null);
  return updates;
}
