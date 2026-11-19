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
