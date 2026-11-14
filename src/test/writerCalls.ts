import { strict as assert } from "node:assert";
import type { BuilderError } from "@antelopejs/interface-dms-builder";

function stubList(key: string): unknown[] {
  const list: unknown = Object.getOwnPropertyDescriptor(
    globalThis,
    Symbol.for(key),
  )?.value;
  assert.ok(Array.isArray(list), "the writer stub is loaded");
  return list;
}

/** The calls the configuration writer stub received, in order. */
export function writerCalls(): unknown[] {
  return stubList("dms-database-test:configure-module");
}

/**
 * Makes the writer stub answer its next call with a refusal, or reject it as a call no builder
 * answers.
 *
 * @param answer The builder error to refuse with, or `"absent"`
 */
export function answerNextWrite(answer: BuilderError | "absent"): void {
  stubList("dms-database-test:configure-module-answers").push(answer);
}
