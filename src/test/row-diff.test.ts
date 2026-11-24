import { strict as assert } from "node:assert";
import fc from "fast-check";
import { fieldChangedNode, rowDiffNode } from "../automation/rowDiff";

const diff = (input: Parameters<typeof rowDiffNode.evaluate>[0]) =>
  rowDiffNode.evaluate(input);
const field = (input: Parameters<typeof fieldChangedNode.evaluate>[0]) =>
  fieldChangedNode.evaluate(input);

describe("the row diff data node", () => {
  it("lists every field of an insert as added", () => {
    const answer = diff({ old: null, new: { _id: "r1", name: "a" } });
    assert.deepEqual(answer.fields, ["_id", "name"]);
    assert.deepEqual(answer.added, ["_id", "name"]);
    assert.deepEqual(answer.before, { _id: null, name: null });
    assert.equal(answer.complete, true);
  });

  it("lists every field of a delete as removed", () => {
    const answer = diff({ old: { _id: "r1", name: "a" }, new: null });
    assert.deepEqual(answer.removed, ["_id", "name"]);
    assert.deepEqual(answer.after, { _id: null, name: null });
  });

  it("lists the one field an update changed, with both values", () => {
    assert.deepEqual(
      diff({
        old: { _id: "r1", name: "a", n: 1 },
        new: { _id: "r1", name: "b", n: 1 },
      }),
      {
        changed: true,
        fields: ["name"],
        added: [],
        removed: [],
        before: { name: "a" },
        after: { name: "b" },
        complete: true,
      },
    );
  });

  it("sees a nested object with its keys reordered as equal, and an array reordered as changed", () => {
    assert.equal(
      diff({ old: { a: { x: 1, y: 2 } }, new: { a: { y: 2, x: 1 } } }).changed,
      false,
    );
    assert.deepEqual(diff({ old: { a: [1, 2] }, new: { a: [2, 1] } }).fields, [
      "a",
    ]);
  });

  it("leaves out the ignored fields", () => {
    const answer = diff({
      old: { name: "a", updatedAt: "2026-01-01T00:00:00.000Z" },
      new: { name: "a", updatedAt: "2026-01-02T00:00:00.000Z" },
      ignore: " updatedAt , other",
    });
    assert.equal(answer.changed, false);
  });

  it("compares dates as the ISO strings the run holds", () => {
    const at = "2026-11-20T10:00:00.000Z";
    assert.equal(diff({ old: { at }, new: { at } }).changed, false);
  });

  it("reports nothing changed and complete false for a key-only old row, or no row at all", () => {
    const keyOnly = diff({ old: { _id: "r1" }, new: { _id: "r1", name: "b" } });
    assert.deepEqual(
      {
        changed: keyOnly.changed,
        fields: keyOnly.fields,
        complete: keyOnly.complete,
      },
      { changed: false, fields: [], complete: false },
    );
    assert.equal(diff({ old: null, new: null }).complete, false);
  });

  it("finds no difference between a row and itself, and its fields are the added, removed and changed ones", () => {
    const json = fc.jsonValue();
    const row = fc.dictionary(fc.stringMatching(/^[a-z]{1,6}$/), json, {
      maxKeys: 6,
    });
    assert.doesNotThrow(() => {
      fc.assert(
        fc.property(row, (value) => {
          const self = diff({ old: value, new: structuredClone(value) });
          return self.fields.length === 0 && self.changed === false;
        }),
      );
      fc.assert(
        fc.property(row, row, (old, next) => {
          const answer = diff({
            old: { _id: "k", ...old },
            new: { _id: "k", ...next, extra: 1 },
          });
          const changed = answer.fields.filter(
            (name) =>
              !answer.added.includes(name) && !answer.removed.includes(name),
          );
          const union = [...answer.added, ...answer.removed, ...changed].sort();
          return JSON.stringify(union) === JSON.stringify(answer.fields);
        }),
      );
    });
  });
});

describe("the field changed data node", () => {
  it("tells a changed scalar from an unchanged one", () => {
    assert.deepEqual(field({ old: { s: "a" }, new: { s: "b" }, field: "s" }), {
      changed: true,
      before: "a",
      after: "b",
      complete: true,
    });
    assert.equal(
      field({ old: { s: "a" }, new: { s: "a" }, field: "s" }).changed,
      false,
    );
  });

  it("reads a nested path, own properties only", () => {
    const answer = field({
      old: { address: { city: "Paris" } },
      new: { address: { city: "Lyon" } },
      field: "address.city",
    });
    assert.deepEqual([answer.before, answer.after], ["Paris", "Lyon"]);
    assert.equal(
      field({ old: {}, new: {}, field: "constructor" }).before,
      null,
    );
  });

  it("sees a field going from absent to a value as changed, as an insert does", () => {
    assert.equal(
      field({ old: { a: 1 }, new: { a: 1, b: 2 }, field: "b" }).changed,
      true,
    );
    assert.deepEqual(field({ old: null, new: { b: 2 }, field: "b" }), {
      changed: true,
      before: null,
      after: 2,
      complete: true,
    });
    assert.equal(field({ old: { b: 2 }, new: null, field: "b" }).changed, true);
  });

  it("reports nothing changed and complete false for a key-only old row", () => {
    const answer = field({
      old: { _id: "r1" },
      new: { _id: "r1", s: "b" },
      field: "s",
    });
    assert.equal(answer.changed, false);
    assert.equal(answer.complete, false);
  });

  it("fails without a field", () => {
    assert.throws(() => field({ old: {}, new: {}, field: "" }), {
      message: "field-changed: 'field' is required",
    });
  });
});
