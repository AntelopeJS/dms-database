import { isJsonObjectValue, type JsonValue } from "../../types/json";
import { isString } from "../../utils/guards";

/** The value at `path` inside `value`, or `null` when a step is not an object or lacks the key. */
export function at(value: JsonValue, ...path: string[]): JsonValue {
  let current = value;
  for (const key of path) {
    if (!isJsonObjectValue(current)) return null;
    current = current[key] ?? null;
  }
  return current;
}

/** The array at `path` inside `value`, or an empty one when it is not an array. */
export function itemsAt(value: JsonValue, ...path: string[]): JsonValue[] {
  const found = at(value, ...path);
  return Array.isArray(found) ? found : [];
}

/** The string at `path` inside `value`, or `""` when it is not a string. */
export function textAt(value: JsonValue, ...path: string[]): string {
  const found = at(value, ...path);
  return isString(found) ? found : "";
}

/** The member names of the object at `path` inside `value`, in order, or none when it is not an object. */
export function keysAt(value: JsonValue, ...path: string[]): string[] {
  const found = at(value, ...path);
  return isJsonObjectValue(found) ? Object.keys(found) : [];
}
