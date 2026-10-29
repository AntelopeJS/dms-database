import { assert } from "@antelopejs/interface-api-util";
import { isNonEmptyString } from "./guards";

/**
 * Request-field coercions shared by the API controllers. Unlike the parsing
 * helpers in ./query (which return undefined on bad input), these assert an
 * HTTP 400 on failure, so a caller can treat the result as always valid.
 */
export function assertNonEmptyString(value: unknown): asserts value is string {
  assert(isNonEmptyString(value), 400, "Expected non-empty string");
}
