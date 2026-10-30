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

/**
 * Whether `value` is made of JSON values only, however deep. It walks with an
 * explicit stack, so a deeply nested value cannot overflow the call stack, and
 * reads a container shared by several members once.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  const pending: unknown[] = [value];
  const visited = new Set<unknown>();
  while (pending.length > 0) {
    const member = pending.pop();
    if (member === null) continue;
    switch (typeof member) {
      case "string":
      case "number":
      case "boolean":
        break;
      case "object":
        if (visited.has(member)) break;
        visited.add(member);
        if (Array.isArray(member)) {
          member.forEach((element) => {
            pending.push(element);
          });
        } else {
          for (const entry of Object.values(member)) pending.push(entry);
        }
        break;
      default:
        return false;
    }
  }
  return true;
}

/** Whether `value` is an object made of JSON values only, however deep. */
export function isJsonObject(value: unknown): value is JsonObject {
  return isJsonValue(value) && isJsonObjectValue(value);
}
