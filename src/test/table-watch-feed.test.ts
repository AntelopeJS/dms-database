import { strict as assert } from "node:assert";
import { setTimeout as delay } from "node:timers/promises";
import { Schema } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ExecutionCtx } from "@antelopejs/interface-dms-automation";
import { LOOP_GUARD_LIMIT } from "../automation/loopGuard";
import { runSavedQueryAction } from "../automation/savedQuery";
import { tableWatchTrigger } from "../automation/tableWatch";
import { SavedQueryModel } from "../db";
import { withOwnDatabase } from "./ownDatabase";
import { encode } from "./stagedWire";

type Emitted = Parameters<Parameters<typeof tableWatchTrigger.activate>[1]>[0];

const SCHEMA = "table-watch-feed";
const schema = new Schema<{ rows: { _id: string; name: string } }>(SCHEMA, {
  rows: { fields: { _id: "string", name: "string" }, indexes: {} },
});

const UNRECORDED = "table-watch-unrecorded";
const unrecorded = new Schema<{ rows: { _id: string } }>(UNRECORDED, {
  rows: { fields: { _id: "string" }, indexes: {} },
});

const TENANTS = ["watch-a", "watch-b"];

function ctxOf(procedureId: string, runId: string): ExecutionCtx {
  return { procedureId, runId, nodeId: "write", log: () => undefined };
}

async function saveQuery(name: string, staged: Parameters<typeof encode>[0]) {
  const now = new Date();
  const [id] = await GetModel(SavedQueryModel).insert({
    userId: "table-watch-feed-owner",
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

async function watch(
  config: Parameters<typeof tableWatchTrigger.activate>[0],
  events: Emitted[],
) {
  return tableWatchTrigger.activate(config, (event) => events.push(event));
}

async function until(events: Emitted[], count: number): Promise<void> {
  for (let waited = 0; events.length < count && waited < 10_000; waited += 50) {
    await delay(50);
  }
}

function instanceWatchTests(): void {
  before(async () => {
    for (const tenant of TENANTS) await schema.createInstance(tenant).run();
  });
  after(async () => {
    for (const tenant of TENANTS) await schema.destroyInstance(tenant).run();
  });

  it("watches the named instance only, and names it on each event, which a watch of the default instance would not", async () => {
    const named: Emitted[] = [];
    const fallback: Emitted[] = [];
    const namedHandle = await watch(
      { schema: SCHEMA, table: "rows", instance: "watch-a" },
      named,
    );
    const defaultHandle = await watch(
      { schema: SCHEMA, table: "rows" },
      fallback,
    );
    try {
      await schema
        .instance("watch-b")
        .table("rows")
        .insert({ _id: "b1", name: "b" })
        .run();
      await schema
        .instance("watch-a")
        .table("rows")
        .insert({ _id: "a1", name: "a" })
        .run();
      await until(named, 1);
      await delay(500);
      assert.deepEqual(
        named.map(({ instance, new: row }) => ({ instance, row })),
        [{ instance: "watch-a", row: { _id: "a1", name: "a" } }],
      );
      assert.deepEqual(fallback, []);
    } finally {
      await tableWatchTrigger.deactivate(namedHandle);
      await tableWatchTrigger.deactivate(defaultHandle);
    }
  });

  it("watches every instance through one feed with allInstances, each event naming its instance and its rows without the tag", async () => {
    const events: Emitted[] = [];
    const handle = await watch(
      { schema: SCHEMA, table: "rows", allInstances: true },
      events,
    );
    try {
      await schema
        .instance("watch-a")
        .table("rows")
        .insert({ _id: "a2", name: "a" })
        .run();
      await schema
        .instance("watch-b")
        .table("rows")
        .insert({ _id: "b2", name: "b" })
        .run();
      await until(events, 2);
      assert.deepEqual(
        events.map(({ instance, new: row }) => ({ instance, row })),
        [
          { instance: "watch-a", row: { _id: "a2", name: "a" } },
          { instance: "watch-b", row: { _id: "b2", name: "b" } },
        ],
      );
    } finally {
      await tableWatchTrigger.deactivate(handle);
    }
  });

  it("refuses an instance the schema does not list, and an instance with allInstances", async () => {
    await assert.rejects(
      watch({ schema: SCHEMA, table: "rows", instance: "watch-z" }, []),
      {
        message: `table-watch: unknown instance "watch-z" in schema "${SCHEMA}"`,
      },
    );
    await assert.rejects(
      watch(
        {
          schema: SCHEMA,
          table: "rows",
          instance: "watch-a",
          allInstances: true,
        },
        [],
      ),
      {
        message:
          "table-watch: name an instance or watch every instance, not both",
      },
    );
    await assert.rejects(
      watch({ schema: "s".repeat(129), table: "rows" }, []),
      {
        message: "table-watch: 'schema' is longer than 128 characters",
      },
    );
  });
}

function procedureWriteTests(): void {
  const table = () => schema.instance().table("rows");

  beforeEach(async () => {
    await table().delete().run();
    await table()
      .insert([
        { _id: "p1", name: "one" },
        { _id: "p2", name: "two" },
      ])
      .run();
  });

  it("ignores the rows Run saved query writes unless includeAutomationWrites is on, which then names the procedure and the run", async () => {
    const queryId = await saveQuery(
      "rename all",
      table().update({ name: "renamed" }),
    );
    const ignoring: Emitted[] = [];
    const including: Emitted[] = [];
    const ignoringHandle = await watch(
      { schema: SCHEMA, table: "rows" },
      ignoring,
    );
    const includingHandle = await watch(
      { schema: SCHEMA, table: "rows", includeAutomationWrites: true },
      including,
    );
    try {
      const answer = await runSavedQueryAction.execute(
        { queryId, allowWrite: true },
        ctxOf("proc-rename", "run-rename"),
      );
      assert.equal(answer.rowCount, 2);
      await until(including, 2);
      await delay(500);
      assert.equal(ignoring.length, 0);
      assert.deepEqual(
        including.map(({ type, originProcedureId, originRunId }) => ({
          type,
          originProcedureId,
          originRunId,
        })),
        [
          {
            type: "update",
            originProcedureId: "proc-rename",
            originRunId: "run-rename",
          },
          {
            type: "update",
            originProcedureId: "proc-rename",
            originRunId: "run-rename",
          },
        ],
      );

      await table().get("p1").update({ name: "by hand" }).run();
      await until(ignoring, 1);
      assert.equal(
        ignoring.length,
        1,
        "a person's change after the write still fires",
      );
      assert.equal(ignoring[0]?.originProcedureId, undefined);
    } finally {
      await tableWatchTrigger.deactivate(ignoringHandle);
      await tableWatchTrigger.deactivate(includingHandle);
    }
  });

  it("stops a procedure feeding itself after a few writes: the loop guard drops later writes' changes", async () => {
    const queries = [
      await saveQuery(
        "touch one a",
        table().get("p1").update({ name: "loop a" }),
      ),
      await saveQuery(
        "touch one b",
        table().get("p1").update({ name: "loop b" }),
      ),
    ];
    const events: Emitted[] = [];
    const handle = await watch(
      { schema: SCHEMA, table: "rows", includeAutomationWrites: true },
      events,
    );
    try {
      for (let round = 0; round <= LOOP_GUARD_LIMIT; round++) {
        await runSavedQueryAction.execute(
          { queryId: queries[round % 2] ?? "", allowWrite: true },
          ctxOf("proc-loop", `run-${round}`),
        );
        await until(events, Math.min(round + 1, LOOP_GUARD_LIMIT));
      }
      await delay(1_000);
      assert.equal(events.length, LOOP_GUARD_LIMIT);
      assert.ok(
        events.every(
          ({ originProcedureId }) => originProcedureId === "proc-loop",
        ),
      );
    } finally {
      await tableWatchTrigger.deactivate(handle);
    }
  });
}

describe("[integration] the table watch", function () {
  this.timeout(30_000);

  it("hands its run the insert, update and delete of a row of the default instance, and nothing of another instance", async () => {
    const events: Emitted[] = [];
    const handle = await tableWatchTrigger.activate(
      { schema: SCHEMA, table: "rows" },
      (event) => events.push(event),
    );
    try {
      const other = schema.instance("other").table("rows");
      await other.insert({ _id: "o1", name: "elsewhere" }).run();
      await other.get("o1").delete().run();
      const table = schema.instance().table("rows");
      await table.insert({ _id: "r1", name: "first" }).run();
      await table.get("r1").update({ name: "second" }).run();
      await table.get("r1").delete().run();
      await until(events, 3);
      await delay(500);
      assert.deepEqual(
        events.map(({ type, old, new: row }) => ({ type, old, new: row })),
        [
          { type: "insert", old: null, new: { _id: "r1", name: "first" } },
          {
            type: "update",
            old: { _id: "r1", name: "first" },
            new: { _id: "r1", name: "second" },
          },
          { type: "delete", old: { _id: "r1", name: "second" }, new: null },
        ],
      );
    } finally {
      await tableWatchTrigger.deactivate(handle);
      await schema.destroyInstance("other").run();
    }
  });

  it("fails its activation with the store's refusal on a collection that records no pre-images", async () => {
    await unrecorded.instance().table("rows").insert({ _id: "seed" }).run();
    const collection = `${UNRECORDED}__rows`;
    await withOwnDatabase((db) =>
      db.command({
        collMod: collection,
        changeStreamPreAndPostImages: { enabled: false },
      }),
    );
    await assert.rejects(
      tableWatchTrigger.activate(
        { schema: UNRECORDED, table: "rows" },
        () => undefined,
      ),
      {
        message: `table-watch: cannot open change feed on ${UNRECORDED}.rows: changes() of one instance needs change stream pre-images, which collection ${collection} does not record, so the feed would miss its updates and deletes: enable them with db.runCommand({ collMod: "${collection}", changeStreamPreAndPostImages: { enabled: true } })`,
      },
    );
  });

  describe("on instances", () => {
    instanceWatchTests();
  });

  describe("on changes a procedure makes", () => {
    procedureWriteTests();
  });
});
