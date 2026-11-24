import type { JsonObject } from "@antelopejs/interface-dms-automation";
import { isBoolean, isFiniteNumber, isObject, isString } from "../utils/guards";

/** An action's input, as the run resolves its ports. */
export type NodeInput = JsonObject;

function read(input: NodeInput, name: string): NodeInput[string] {
  return Object.hasOwn(input, name) ? input[name] : undefined;
}

/**
 * A string input, trimmed unless `exact`: the default when absent or empty,
 * refused when it is not a string or is longer than `max`.
 *
 * @param input The action's input
 * @param name The port
 * @param options The longest value, the default, whether it is required, and whether it is read as is
 * @returns The value
 */
export function stringInput(
  input: NodeInput,
  name: string,
  options: {
    max: number;
    fallback?: string;
    required?: boolean;
    exact?: boolean;
  },
): string {
  const raw = read(input, name);
  if (raw === undefined || raw === null) {
    if (options.required) throw new Error(`'${name}' is required`);
    return options.fallback ?? "";
  }
  if (!isString(raw)) throw new Error(`'${name}' must be a string`);
  const value = options.exact ? raw : raw.trim();
  if (options.required && !value) throw new Error(`'${name}' is required`);
  if (value.length > options.max) {
    throw new Error(`'${name}' is longer than ${options.max} characters`);
  }
  return value || (options.fallback ?? "");
}

/**
 * A boolean input: the default when absent, refused when it is not a boolean.
 *
 * @param input The action's input
 * @param name The port
 * @param fallback The default
 * @returns The value
 */
export function booleanInput(
  input: NodeInput,
  name: string,
  fallback: boolean,
): boolean {
  const raw = read(input, name);
  if (raw === undefined || raw === null) return fallback;
  if (!isBoolean(raw)) throw new Error(`'${name}' must be a boolean`);
  return raw;
}

/**
 * An integer input clamped to its bounds: the default when absent.
 *
 * @param input The action's input
 * @param name The port
 * @param options The default and the bounds
 * @returns The value
 */
export function integerInput(
  input: NodeInput,
  name: string,
  options: { fallback: number; min: number; max: number },
): number {
  const raw = read(input, name);
  if (raw === undefined || raw === null) return options.fallback;
  if (!isFiniteNumber(raw)) throw new Error(`'${name}' must be a number`);
  return Math.min(options.max, Math.max(options.min, Math.trunc(raw)));
}

/**
 * An object input: empty when absent, refused when it is not an object.
 *
 * @param input The action's input
 * @param name The port
 * @returns The value
 */
export function objectInput(input: NodeInput, name: string): JsonObject {
  const raw = read(input, name);
  if (raw === undefined || raw === null) return {};
  if (!isObject(raw) || Array.isArray(raw)) {
    throw new Error(`'${name}' must be an object`);
  }
  return raw;
}
