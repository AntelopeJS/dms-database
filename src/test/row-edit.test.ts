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
});
