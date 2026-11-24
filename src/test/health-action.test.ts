import { strict as assert } from "node:assert";
import type { ExecutionCtx } from "@antelopejs/interface-dms-automation";
import { createHealthAction, healthAction } from "../automation/health";
import { getStorageStats } from "../service/health";

const CTX: ExecutionCtx = {
  procedureId: "health-action",
  runId: "run",
  nodeId: "health",
  log: () => undefined,
};

function countingStats() {
  let count = 0;
  const stats: Parameters<typeof createHealthAction>[1] = (db) => {
    count++;
    return getStorageStats(db);
  };
  return { stats, calls: () => count };
}

describe("[integration] the database health action", () => {
  it("reports the own database up with its counts, largest tables first", async () => {
    const answer = await healthAction.execute({ largestTables: 3 }, CTX);
    assert.equal(answer.connection, "own");
    assert.equal(answer.status, "ok");
    assert.equal(answer.error, null);
    assert.ok((answer.schemaCount ?? 0) > 0);
    assert.ok((answer.tableCount ?? 0) > 0);
    assert.ok(answer.largestTables.length <= 3);
    const rows = answer.largestTables.map((entry) => entry.rows);
    assert.deepEqual(
      rows,
      [...rows].sort((left, right) => right - left),
    );
  });

  it("counts nothing without stats, and answers nulls", async () => {
    const { stats, calls } = countingStats();
    const action = createHealthAction(undefined, stats);
    const answer = await action.execute({ includeStats: false }, CTX);
    assert.equal(answer.status, "ok");
    assert.equal(calls(), 0);
    assert.deepEqual(
      [
        answer.schemaCount,
        answer.tableCount,
        answer.relationCount,
        answer.indexCount,
        answer.totalRows,
      ],
      [null, null, null, null, null],
    );
    assert.deepEqual(answer.largestTables, []);
    await action.execute({}, CTX);
    assert.equal(calls(), 1, "the default counts once");
  });

  it("probes an external database and names its engine", async () => {
    const answer = await healthAction.execute(
      { connection: "erp", largestTables: 0 },
      CTX,
    );
    assert.equal(answer.status, "ok");
    assert.match(answer.driver ?? "", /mongo/i);
    assert.deepEqual(answer.largestTables, []);
  });

  it("answers a probe that timed out as down with the redacted reason, not a failed step", async () => {
    const { stats, calls } = countingStats();
    const action = createHealthAction(
      () =>
        Promise.resolve({
          status: "down",
          latencyMs: null,
          error: "The database did not answer in time",
        }),
      stats,
    );
    const answer = await action.execute({}, CTX);
    assert.equal(calls(), 0, "a connection that is down is not counted");
    assert.equal(answer.totalRows, null);
    assert.equal(answer.status, "down");
    assert.equal(answer.latencyMs, null);
    assert.equal(answer.error, "The database did not answer in time");
  });

  it("probes a read-only external database with its counts", async () => {
    const answer = await healthAction.execute({ connection: "archive" }, CTX);
    assert.equal(answer.status, "ok");
    assert.deepEqual(answer.largestTables, [
      { schema: "archive", table: "invoices", rows: 1 },
    ]);
  });

  it("fails on a connection the project declares without its bindings", async () => {
    await assert.rejects(healthAction.execute({ connection: "blank" }, CTX), {
      message: 'Unknown connection "blank"',
    });
  });

  it("fails on a connection the project does not list", async () => {
    await assert.rejects(healthAction.execute({ connection: "nowhere" }, CTX), {
      message: 'Unknown connection "nowhere"',
    });
  });
});
