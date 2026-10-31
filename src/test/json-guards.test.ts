import { strict as assert } from "node:assert";
import { isJsonObject, isJsonValue } from "../types/json";

interface Nest {
  c?: Nest | (() => number);
}

type Deep = Deep[];

/** An object holding `{ c: { c: ... } }` nested `depth` levels deep, with `bottom` at the end. */
function nested(depth: number, bottom?: () => number): Nest {
  const root: Nest = {};
  let cell = root;
  for (let level = 0; level < depth; level++) {
    const next: Nest = {};
    cell.c = next;
    cell = next;
  }
  if (bottom) cell.c = bottom;
  return root;
}

describe("the JSON guards of the request bodies (AntelopeJS/dms-database#79)", () => {
  it("answers true for an object nested 6,000 levels deep", () => {
    assert.equal(isJsonObject({ cell: nested(6000) }), true);
  });

  it("answers true for a list nested 6,000 levels deep", () => {
    let list: Deep = [];
    for (let level = 0; level < 6000; level++) list = [list];
    assert.equal(isJsonValue(list), true);
  });

  it("answers false for a function at the bottom of a deep object", () => {
    assert.equal(isJsonValue(nested(6000, () => 1)), false);
  });

  it("answers true for a value reached twice by two parents", () => {
    const shared = { a: 1 };
    assert.equal(isJsonValue({ left: shared, right: [shared] }), true);
  });

  it("answers false for a cycle", () => {
    interface Loop {
      self?: Loop;
    }
    const loop: Loop = {};
    loop.self = loop;
    assert.equal(isJsonValue(loop), false);
  });

  it("answers as before for the scalars and the small values", () => {
    assert.equal(isJsonValue(null), true);
    assert.equal(isJsonValue("text"), true);
    assert.equal(isJsonValue(4), true);
    assert.equal(isJsonValue(false), true);
    assert.equal(isJsonValue(undefined), false);
    assert.equal(isJsonValue(1n), false);
    assert.equal(isJsonValue(Symbol("s")), false);
    assert.equal(isJsonValue({ a: [1, { b: null }] }), true);
    assert.equal(isJsonValue({ a: undefined }), false);
    assert.equal(isJsonObject([]), false);
    assert.equal(isJsonObject("text"), false);
    assert.equal(isJsonObject({ a: 1 }), true);
  });
});
