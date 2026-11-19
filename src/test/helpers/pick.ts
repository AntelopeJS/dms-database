import {
  isJsonObjectValue,
  type JsonObject,
  type JsonValue,
} from "../../types/json";
import { isNumber, isString } from "../../utils/guards";

/** The value at `path` in `value`, through objects by key and arrays by index; `undefined` when a step is missing. */
export function pick(
  value: JsonValue | undefined,
  ...path: readonly (string | number)[]
): JsonValue | undefined {
  let current = value;
  for (const step of path) {
    if (isNumber(step) && Array.isArray(current)) {
      current = current[step];
    } else if (
      isString(step) &&
      current !== undefined &&
      isJsonObjectValue(current)
    ) {
      current = current[step];
    } else {
      return undefined;
    }
  }
  return current;
}

/** A text value, or the empty string for any other value. */
export function text(value: JsonValue | undefined): string {
  return isString(value) ? value : "";
}

/** The objects of the array at `path` in `value`; none when it is no array. */
export function objectsAt(
  value: JsonValue | undefined,
  ...path: readonly (string | number)[]
): JsonObject[] {
  const items = pick(value, ...path);
  return Array.isArray(items) ? items.filter(isJsonObjectValue) : [];
}

/** The value at `path` in `value`, or `null` when a step is missing. */
export function at(value: JsonValue, ...path: string[]): JsonValue {
  return pick(value, ...path) ?? null;
}

/** The array at `path` in `value`, or an empty one when it is not an array. */
export function itemsAt(value: JsonValue, ...path: string[]): JsonValue[] {
  const found = pick(value, ...path);
  return Array.isArray(found) ? found : [];
}

/** The string at `path` in `value`, or `""` when it is not a string. */
export function textAt(value: JsonValue, ...path: string[]): string {
  return text(pick(value, ...path));
}

/** The member names of the object at `path` in `value`, in order, or none when it is not an object. */
export function keysAt(value: JsonValue, ...path: string[]): string[] {
  const found = pick(value, ...path);
  return found !== undefined && isJsonObjectValue(found)
    ? Object.keys(found)
    : [];
}
