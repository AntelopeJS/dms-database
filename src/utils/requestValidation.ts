import { assert } from "@antelopejs/interface-api-util";

// Request-field coercions shared by the API controllers. Unlike the parsing
// helpers in ./query (which return undefined on bad input), these assert an
// HTTP 400 on failure, so a caller can treat the result as always valid.

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNonEmptyString(value: unknown): string {
  const str = asString(value);
  assert(str !== undefined && str.length > 0, 400, "Expected non-empty string");
  return str;
}
