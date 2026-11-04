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

/** One step of the walk: a value to check, or the end of a container being walked. */
type WalkStep = { enter: unknown } | { leave: object };

/**
 * Whether `value` is made of JSON values only, however deep. The walk keeps
 * its own stack, so a body nested thousands of levels deep does not overflow
 * the call stack; a value that contains itself is not JSON.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  const walking = new Set<object>();
  const walked = new Set<object>();
  const steps: WalkStep[] = [{ enter: value }];
  for (let step = steps.pop(); step !== undefined; step = steps.pop()) {
    if ("leave" in step) {
      walking.delete(step.leave);
      walked.add(step.leave);
      continue;
    }
    const current = step.enter;
    if (current === null) continue;
    switch (typeof current) {
      case "string":
      case "number":
      case "boolean":
        continue;
      case "object":
        if (walking.has(current)) return false;
        if (walked.has(current)) continue;
        walking.add(current);
        steps.push({ leave: current });
        for (const child of Array.isArray(current)
          ? current.filter(() => true)
          : Object.values(current)) {
          steps.push({ enter: child });
        }
        continue;
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
