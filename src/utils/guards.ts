/** Whether `value` is a string. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Whether `value` is a boolean. */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Whether `value` is a number. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** Whether `value` is a number other than `NaN` and the infinities. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Whether `value` is a non-null object, arrays and class instances included.
 * A value already typed `any` keeps that type.
 */
export function isObject<T>(value: T): value is T & object {
  return typeof value === "object" && value !== null;
}

/** Whether `value` is a string with at least one character. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Whether `value` is a function, a class included. */
export function isFunction(value: unknown): value is Function {
  return typeof value === "function";
}
