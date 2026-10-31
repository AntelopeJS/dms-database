import { strict as assert } from "node:assert";
import { buildEditUpdates } from "../service/rowEdit";

describe("row edit updates", () => {
  const stored = { _id: "r1", cell: { name: "a", tags: ["x"] } };

  it("skips an object cell echoed back unchanged", () => {
    const updates = buildEditUpdates(
      stored,
      { cell: { name: "a", tags: ["x"] } },
      "_id",
    );
    assert.deepEqual(Object.keys(updates), []);
  });

  it("writes an object cell that differs from the stored one", () => {
    const updates = buildEditUpdates(
      stored,
      { cell: { name: "a", tags: ["x", "y"] } },
      "_id",
    );
    assert.deepEqual(updates.cell, { name: "a", tags: ["x", "y"] });
  });

  it("writes an object cell when the stored one cannot be serialised", () => {
    const updates = buildEditUpdates(
      { _id: "r1", cell: { big: 1n } },
      { cell: { big: 1 } },
      "_id",
    );
    assert.deepEqual(updates.cell, { big: 1 });
  });
  it("writes an object cell nested a thousand levels deep", () => {
    interface Nest {
      c?: Nest;
    }
    const cell: Nest = {};
    let level = cell;
    for (let depth = 0; depth < 1000; depth++) {
      const next: Nest = {};
      level.c = next;
      level = next;
    }
    const updates = buildEditUpdates(stored, { cell }, "_id");
    assert.equal(JSON.stringify(updates.cell), JSON.stringify(cell));
  });

  it("skips a cell that is not a JSON value", () => {
    const updates = buildEditUpdates(
      stored,
      { first: () => 1, second: 1n, third: Symbol("s") },
      "_id",
    );
    assert.deepEqual(Object.keys(updates), []);
  });
});
