/** A value as JSON carries it. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

/** An object whose members are all JSON values. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** Whether a decoded JSON value is an object or an array, not a scalar. */
export function isJsonContainer(
  value: JsonValue | undefined,
): value is JsonObject | JsonValue[] {
  return typeof value === "object" && value !== null;
}

/** Whether a decoded JSON value is an object rather than an array or a scalar. */
export function isJsonObjectValue(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is made of JSON values only, however deep. */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    case "object":
      return Object.values(value).every(isJsonValue);
    default:
      return false;
  }
}

/** Whether `value` is an object made of JSON values only, however deep. */
export function isJsonObject(value: unknown): value is JsonObject {
  return isJsonValue(value) && isJsonObjectValue(value);
}

/**
 * Whether a decoded request body is an object rather than an array or a
 * scalar. The body was parsed from JSON, so only its top level is left to
 * check.
 */
export function isJsonObjectBody(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
