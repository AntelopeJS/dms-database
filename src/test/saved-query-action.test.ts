import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ExecutionCtx } from "@antelopejs/interface-dms-automation";
import { runSavedQueryAction } from "../automation/savedQuery";
import { SavedQueryModel } from "../db";
import { SCHEMA_NAME } from "../types/constants";
import { isFiniteNumber } from "../utils/guards";
import { encode } from "./stagedWire";

const SCHEMA = "saved-query-action";
const schema = new Schema<{ items: { _id: string; n: number; at: Date } }>(
  SCHEMA,
  {
    items: { fields: { _id: "string", n: "number", at: "date" }, indexes: {} },
  },
);
const items = () => schema.instance().table("items");
const AT = new Date("2026-10-01T00:00:00.000Z");

const CTX: ExecutionCtx = {
  procedureId: "saved-query-action",
  runId: "run",
  nodeId: "query",
  log: () => undefined,
};
const TEST_CTX: ExecutionCtx = { ...CTX, dryRun: true };

async function save(
  name: string,
  staged: Parameters<typeof encode>[0],
): Promise<string> {
  const now = new Date();
  const [id] = await GetModel(SavedQueryModel).insert({
    userId: "saved-query-action-owner",
    name,
    description: "",
    query: encode(staged),
    source: name,
    language: "aql",
    shared: false,
    createdAt: now,
    updatedAt: now,
  });
  assert.ok(id);
  return id;
}

async function historyRows(): Promise<number> {
  const history = Schema.get(SCHEMA_NAME)?.instance().table("query_history");
  assert.ok(history);
  const total: unknown = await history.count().run();
  assert.ok(isFiniteNumber(total));
  return total;
}

async function dryRunOf(
  input: Parameters<typeof runSavedQueryAction.execute>[0],
) {
  const answer = await runSavedQueryAction.dryRun?.(input, TEST_CTX);
  assert.ok(answer);
  return answer;
}

describe("[integration] the run saved query action", () => {
  let readAll: string;
  let deleteBig: string;

  before(async () => {
    readAll = await save("all items", items());
    deleteBig = await save(
      "delete big",
      items()
        .filter((row) => row.key("n").gt(2))
        .delete(),
    );
  });

  beforeEach(async () => {
    await items().delete().run();
    await items()
      .insert([1, 2, 3, 4, 5].map((n) => ({ _id: `i${n}`, n, at: AT })))
      .run();
  });

  it("answers a read's rows as JSON, a date as its ISO string", async () => {
    const answer = await runSavedQueryAction.execute({ queryId: readAll }, CTX);
    assert.equal(answer.queryName, "all items");
    assert.equal(answer.operation, "read");
    assert.equal(answer.mutation, false);
    assert.equal(answer.simulated, false);
    assert.equal(answer.rowCount, 5);
    assert.equal(answer.truncated, false);
    assert.deepEqual(
      answer.rows.find((row) => row._id === "i1"),
      {
        _id: "i1",
        n: 1,
        at: "2026-10-01T00:00:00.000Z",
      },
    );
  });

  it("cuts a read at maxRows and counts the rest in the database", async () => {
    const answer = await runSavedQueryAction.execute(
      { queryId: readAll, maxRows: 2 },
      CTX,
    );
    assert.equal(answer.rows.length, 2);
    assert.equal(answer.truncated, true);
    assert.equal(answer.rowCount, 5);
  });

  it("refuses a write without allowWrite, in a run and in a test run, and writes nothing", async () => {
    const message =
      'Saved query "delete big" writes: turn on Allow write to run it';
    await assert.rejects(
      runSavedQueryAction.execute({ queryId: deleteBig }, CTX),
      { message },
    );
    await assert.rejects(dryRunOf({ queryId: deleteBig }), { message });
    assert.equal(await items().count().run(), 5);
  });

  it("runs a write with allowWrite and answers the rows it changed", async () => {
    const answer = await runSavedQueryAction.execute(
      { queryId: deleteBig, allowWrite: true },
      CTX,
    );
    assert.equal(answer.operation, "delete");
    assert.equal(answer.mutation, true);
    assert.equal(answer.rowCount, 3);
    assert.equal(await items().count().run(), 2);
  });

  it("measures a write in a test run without making it", async () => {
    const answer = await dryRunOf({ queryId: deleteBig, allowWrite: true });
    assert.equal(answer.simulated, true);
    assert.equal(answer.rowCount, 3);
    assert.deepEqual(answer.rows, []);
    assert.equal(await items().count().run(), 5);
  });

  it("runs a read for real in a test run", async () => {
    const answer = await dryRunOf({ queryId: readAll });
    assert.equal(answer.simulated, false);
    assert.equal(answer.rows.length, 5);
  });

  it("fails on an unknown id, and on an instance the schema does not list with the console's message", async () => {
    await assert.rejects(
      runSavedQueryAction.execute({ queryId: "missing" }, CTX),
      {
        message: 'Saved query "missing" not found',
      },
    );
    const elsewhere = await save(
      "elsewhere",
      schema.instance("nowhere").table("items"),
    );
    await assert.rejects(
      runSavedQueryAction.execute({ queryId: elsewhere }, CTX),
      {
        message: `Unknown instance "nowhere" in schema ${SCHEMA} (it has no named instance)`,
      },
    );
  });

  it("writes no query history: the run trace is the record", async () => {
    const before = await historyRows();
    await runSavedQueryAction.execute({ queryId: readAll }, CTX);
    await runSavedQueryAction.execute(
      { queryId: deleteBig, allowWrite: true },
      CTX,
    );
    assert.equal(await historyRows(), before);
  });
});
