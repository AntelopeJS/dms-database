import { strict as assert } from "node:assert";
import { jsonRows } from "../automation/tableWatch";

describe("the rows a table watch hands its run", () => {
  it("are JSON, a date as its ISO string", () => {
    assert.deepEqual(
      jsonRows({
        changeType: "modified",
        oldValue: { _id: "r1", at: new Date("2026-10-19T10:00:00.000Z") },
        newValue: {
          _id: "r1",
          at: new Date("2026-10-20T08:30:00.000Z"),
          tags: ["a", "b"],
          nested: { count: 1, empty: null },
        },
      }),
      {
        old: { _id: "r1", at: "2026-10-19T10:00:00.000Z" },
        new: {
          _id: "r1",
          at: "2026-10-20T08:30:00.000Z",
          tags: ["a", "b"],
          nested: { count: 1, empty: null },
        },
      },
    );
  });

  it("are null where the change carries none", () => {
    assert.deepEqual(
      jsonRows({ changeType: "added", newValue: { _id: "r2" } }),
      { old: null, new: { _id: "r2" } },
    );
  });
});
