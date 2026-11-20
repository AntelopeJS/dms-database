import { strict as assert } from "node:assert";
import { AutomationLoopGuard } from "../automation/loopGuard";
import { ProcedureWriteRegistry } from "../automation/origin";

const ORIGIN = { procedureId: "proc-a", runId: "run-1" };
const ROWS = { schema: "shop", table: "orders", instance: "" };
const watchOf = (id: string, openedAt = 0) => ({ id, openedAt });
const WATCH = watchOf("watch");

describe("the procedure write registry", () => {
  it("attributes a change of the written table while the write runs, whatever the count", () => {
    const writes = new ProcedureWriteRegistry();
    writes.begin(ORIGIN, ROWS);
    for (let change = 0; change < 3; change++) {
      assert.equal(writes.attribute(WATCH, ROWS, 0)?.procedureId, "proc-a");
    }
  });

  it("attributes as many changes per watch as the write changed rows, then none: a person's later change fires", () => {
    const writes = new ProcedureWriteRegistry();
    const id = writes.begin(ORIGIN, ROWS);
    writes.settle(id, 2, 0);
    assert.ok(writes.attribute(watchOf("watch-1"), ROWS, 1));
    assert.ok(writes.attribute(watchOf("watch-1"), ROWS, 2));
    assert.equal(writes.attribute(watchOf("watch-1"), ROWS, 3), undefined);
    assert.ok(
      writes.attribute(watchOf("watch-2"), ROWS, 4),
      "another watch reads the same changes",
    );
  });

  it("counts the changes seen while the write ran against its changed-row count", () => {
    const writes = new ProcedureWriteRegistry();
    const id = writes.begin(ORIGIN, ROWS);
    assert.ok(writes.attribute(WATCH, ROWS, 0));
    writes.settle(id, 1, 1);
    assert.equal(writes.attribute(WATCH, ROWS, 2), undefined);
  });

  it("forgets a write once its settle window passed", () => {
    const writes = new ProcedureWriteRegistry(1_000);
    const id = writes.begin(ORIGIN, ROWS);
    writes.settle(id, 5, 0);
    assert.ok(writes.attribute(WATCH, ROWS, 1_000));
    assert.equal(writes.attribute(WATCH, ROWS, 1_001), undefined);
  });

  it("attributes any number of changes in the window when the write did not say how many rows it changed", () => {
    const writes = new ProcedureWriteRegistry(1_000);
    const id = writes.begin(ORIGIN, ROWS);
    writes.settle(id, undefined, 0);
    for (let change = 0; change < 4; change++) {
      assert.ok(writes.attribute(WATCH, ROWS, 10));
    }
  });

  it("leaves changes of another table, schema or instance alone", () => {
    const writes = new ProcedureWriteRegistry();
    writes.begin(ORIGIN, ROWS);
    assert.equal(
      writes.attribute(WATCH, { ...ROWS, table: "items" }, 0),
      undefined,
    );
    assert.equal(
      writes.attribute(WATCH, { ...ROWS, schema: "crm" }, 0),
      undefined,
    );
    assert.equal(
      writes.attribute(WATCH, { ...ROWS, instance: "t1" }, 0),
      undefined,
    );
  });

  it("leaves a watch opened after the write ended alone: its feed never read those changes", () => {
    const writes = new ProcedureWriteRegistry();
    const id = writes.begin(ORIGIN, ROWS);
    writes.settle(id, 2, 100);
    assert.equal(writes.attribute(watchOf("late", 101), ROWS, 102), undefined);
    assert.ok(writes.attribute(watchOf("early", 50), ROWS, 102));
  });

  it("matches every instance for a write across instances", () => {
    const writes = new ProcedureWriteRegistry();
    writes.begin(ORIGIN, { ...ROWS, instance: "*" });
    assert.ok(writes.attribute(WATCH, { ...ROWS, instance: "t1" }, 0));
    assert.ok(writes.attribute(WATCH, { ...ROWS, instance: "" }, 0));
  });
});

describe("the automation loop guard", () => {
  it("passes every change of an admitted write, so one write of many rows is not cut", () => {
    const guard = new AutomationLoopGuard(2, 60_000);
    for (let change = 0; change < 10; change++) {
      assert.equal(guard.admit("watch|proc", 1, 0), true);
    }
  });

  it("drops the changes of a write past the limit within the window, and admits again after it", () => {
    const guard = new AutomationLoopGuard(2, 60_000);
    assert.equal(guard.admit("watch|proc", 1, 0), true);
    assert.equal(guard.admit("watch|proc", 2, 1), true);
    assert.equal(guard.admit("watch|proc", 3, 2), false);
    assert.equal(
      guard.admit("watch|other", 4, 2),
      true,
      "another subject counts apart",
    );
    assert.equal(guard.admit("watch|proc", 5, 60_002), true);
  });
});
