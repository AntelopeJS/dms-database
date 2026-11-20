import { strict as assert } from "node:assert";
import { jsonRows } from "../service/jsonRows";

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
        instance: "",
      },
    );
  });

  it("leave out the instance tag the store reads with each row", () => {
    assert.deepEqual(
      jsonRows({
        changeType: "modified",
        oldValue: { _id: "r3", _instance: null, name: "before" },
        newValue: { _id: "r3", _instance: null, name: "after" },
      }),
      {
        old: { _id: "r3", name: "before" },
        new: { _id: "r3", name: "after" },
        instance: "",
      },
    );
  });

  it("name the instance the tag held apart from the rows: the new row's, else the old row's", () => {
    assert.deepEqual(
      jsonRows({
        changeType: "modified",
        oldValue: { _id: "r4", _instance: "tenant-a", n: 1 },
        newValue: { _id: "r4", _instance: "tenant-a", n: 2 },
      }),
      {
        old: { _id: "r4", n: 1 },
        new: { _id: "r4", n: 2 },
        instance: "tenant-a",
      },
    );
    assert.equal(
      jsonRows({
        changeType: "removed",
        oldValue: { _id: "r5", _instance: "tenant-b" },
      }).instance,
      "tenant-b",
    );
  });

  it("are null where the change carries none", () => {
    assert.deepEqual(
      jsonRows({ changeType: "added", newValue: { _id: "r2" } }),
      { old: null, new: { _id: "r2" }, instance: "" },
    );
  });
});
