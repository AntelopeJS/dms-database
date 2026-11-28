import { strict as assert } from "node:assert";
import { setTimeout as sleep } from "node:timers/promises";
import { IsHTTPResult } from "@antelopejs/interface-api";
import { Query, Schema } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { getModuleConfig, setModuleConfig } from "../config";
import { QueryHistoryModel } from "../db";
import { DatabaseQueryController } from "../routes/query";
import { isRecord } from "../utils/guards";
import { queryFailure } from "./refusal";
import { encode } from "./stagedWire";

const SCHEMA = "query-deadline-qa";
const USER = Object.assign(new User(), { _id: "query-deadline-user" });
const DEADLINE_MS = 20;
const SLOW_MS = 200;
const HTTP_BAD_REQUEST = 400;

interface Item {
  _id: string;
}

const schema = new Schema<{ items: Item }>(SCHEMA, {
  items: { fields: { _id: "string" }, indexes: {} },
});

function items() {
  return schema.instance().table("items");
}

/** The console's run of the items table. */
function execute() {
  return new DatabaseQueryController().execute(USER, {
    query: encode(items()),
    source: "items",
    language: "aql",
  });
}

/** Runs `work` while every cursor the database opens waits {@link SLOW_MS} before its first row. */
async function withSlowCursors<T>(work: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(Query.prototype, "cursor");
  assert.ok(original);
  Query.prototype.cursor = async function* () {
    Object.defineProperty(this, "cursor", original);
    await sleep(SLOW_MS);
    yield* this.cursor();
  };
  try {
    return await work();
  } finally {
    Object.defineProperty(Query.prototype, "cursor", original);
  }
}

/** The diagnostic a refused run answers. */
async function refusedRun() {
  try {
    await execute();
  } catch (error) {
    if (!IsHTTPResult(error)) throw error;
    return { status: error.getStatus(), ...queryFailure(error) };
  }
  throw new Error("the run was expected to be refused");
}

async function lastRun() {
  const { items: runs } = await GetModel(QueryHistoryModel).listForUser(
    USER._id,
    1,
    0,
  );
  return runs[0];
}

describe("[integration] the query console's deadline", () => {
  const original = getModuleConfig();

  before(async () => {
    await items()
      .insert([{ _id: "a" }])
      .run();
  });

  afterEach(() => setModuleConfig(original));

  after(async () => {
    await items().delete().run();
    await GetModel(QueryHistoryModel).clearForUser(USER._id);
  });

  it("refuses a run past queryDeadlineMs with a diagnostic and keeps it in the history as an error, which waiting on the database would hang the request on", async () => {
    setModuleConfig({ ...original, queryDeadlineMs: DEADLINE_MS });
    const refused = await withSlowCursors(refusedRun);
    assert.equal(refused.status, HTTP_BAD_REQUEST);
    assert.match(refused.message, /did not answer in time/);
    assert.ok(refused.durationMs >= DEADLINE_MS);
    assert.ok(refused.durationMs < SLOW_MS);
    const run = await lastRun();
    assert.equal(run?.status, "error");
    assert.match(run?.error ?? "", /did not answer in time/);
  });

  it("waits for a slow run under the default deadline, which a deadline applied whatever the configuration would refuse", async () => {
    const { rows, rowCount } = await withSlowCursors(execute);
    assert.deepEqual(
      rows.map((row) => (isRecord(row) ? row._id : row)),
      ["a"],
    );
    assert.equal(rowCount, 1);
  });

  it("reads a deadline that is not a positive number as the default", async () => {
    setModuleConfig({ ...original, queryDeadlineMs: 0 });
    const { rowCount } = await execute();
    assert.equal(rowCount, 1);
  });
});
