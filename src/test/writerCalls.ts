import { strict as assert } from "node:assert";

/** The calls the configuration writer stub received, in order. */
export function writerCalls(): unknown[] {
  const calls: unknown = Object.getOwnPropertyDescriptor(
    globalThis,
    Symbol.for("dms-database-test:configure-module"),
  )?.value;
  assert.ok(Array.isArray(calls), "the writer stub is loaded");
  return calls;
}
