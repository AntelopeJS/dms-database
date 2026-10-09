import { strict as assert } from "node:assert";
import { CROSS_INSTANCE, Schema } from "@antelopejs/interface-database";
import {
  GetModel,
  RegisterSchema,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { QueryHistoryModel } from "../db";
import { DatabaseQueryController } from "../routes/query";
import {
  affectedRows,
  describeUnknownQueryTarget,
  readQueryTarget,
} from "../service/queryInspection";
import { CROSS_INSTANCE_SENTINEL } from "../types/constants";

const SCHEMA = "query-console-qa";
const INSTANCE = "eu";
const USER = { _id: "query-console-user" } as User;

@RegisterTable("tags", SCHEMA)
class ConsoleTag extends Table {
  declare _id: string;
  declare label: string;
}

// Keeps the decorated class referenced: the decorator registers it.
const TABLES = [ConsoleTag];

const STAGED_CLASS_NAMES = new Set([
  "Schema",
  "SchemaInstance",
  "Table",
  "Selection",
  "SingleSelection",
  "Stream",
  "Datum",
  "Query",
  "ValueProxy",
]);

function encodeNode(node: unknown): unknown {
  if (node === CROSS_INSTANCE) return CROSS_INSTANCE_SENTINEL;
  if (Array.isArray(node)) return node.map(encodeNode);
  if (node === null || typeof node !== "object") return node;
  const cls = node.constructor?.name;
  if (cls && STAGED_CLASS_NAMES.has(cls)) {
    const stages = (node as { stages?: unknown[] }).stages ?? [];
    return { __cls: cls, stages: stages.map(encodeNode) };
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, encodeNode(value)]),
  );
}

interface StagedLike {
  stages: unknown[];
}

// The wire form of a staged query, as the console sends it: every staged
// value nested in a stage (a filter's predicate, say) is encoded too, and the
// whole travels as JSON.
function encode(staged: StagedLike): Record<string, unknown> {
  return JSON.parse(JSON.stringify(encodeNode(staged))) as Record<
    string,
    unknown
  >;
}

function schema() {
  const registered = Schema.get(SCHEMA);
  assert.ok(registered, "the test schema is registered");
  return registered;
}

function tags(instance?: string) {
  return schema()
    .instance(instance)
    .table("tags" as never);
}

async function lastRun() {
  const { items } = await GetModel(QueryHistoryModel).listForUser(
    USER._id,
    1,
    0,
  );
  return items[0];
}

describe("[integration] query console", () => {
  before(async () => {
    assert.equal(TABLES.length, 1);
    await RegisterSchema(SCHEMA);
    await schema()
      .createInstance(INSTANCE)
      .run()
      .catch(() => undefined);
    await tags(INSTANCE)
      .insert([
        { _id: "t1", label: "qa" },
        { _id: "t2", label: "qa" },
        { _id: "t3", label: "qa" },
        { _id: "t4", label: "kept" },
      ] as never)
      .run();
  });

  after(async () => {
    await schema().destroyInstance(INSTANCE).run();
    await GetModel(QueryHistoryModel)
      .table.filter((d) => d.key("userId").eq(USER._id))
      .delete()
      .run();
  });

  it("counts the rows a mutation changed, not the rows it answered", async () => {
    assert.equal(affectedRows(3, 1, true), 3);
    assert.equal(affectedRows(0, 1, true), 0);
    assert.equal(affectedRows(["a", "b"], 2, true), 2);
    assert.equal(affectedRows(7, 1, false), 1);

    const controller = new DatabaseQueryController();
    const qa = tags(INSTANCE).filter((row) =>
      row.key("label" as never).eq("qa"),
    );
    const update = await controller.execute(USER, {
      query: encode(qa.update({ label: "qa-2" } as never) as never),
      source: "update",
      language: "aql",
    });
    assert.equal(update.mutation, true);
    assert.equal(update.rowCount, 3);
    assert.equal((await lastRun())?.rowCount, 3);

    const none = await controller.execute(USER, {
      query: encode(qa.update({ label: "none" } as never) as never),
      source: "update nothing",
      language: "aql",
    });
    assert.equal(none.rowCount, 0);

    const removal = await controller.execute(USER, {
      query: encode(
        tags(INSTANCE)
          .filter((row) => row.key("label" as never).eq("qa-2"))
          .delete() as never,
      ),
      source: "delete",
      language: "aql",
    });
    assert.equal(removal.rowCount, 3);
    assert.equal(await tags(INSTANCE).count(), 1);
  });

  it("names an unknown instance instead of answering no row", async () => {
    assert.equal(
      await describeUnknownQueryTarget(readQueryTarget(tags(INSTANCE))),
      null,
    );
    assert.equal(
      await describeUnknownQueryTarget(readQueryTarget(tags())),
      null,
    );
    assert.equal(
      await describeUnknownQueryTarget(
        readQueryTarget(
          schema()
            .instance(CROSS_INSTANCE)
            .table("tags" as never),
        ),
      ),
      null,
    );
    const message = await describeUnknownQueryTarget(
      readQueryTarget(tags("zz")),
    );
    assert.match(message ?? "", /^Unknown instance "zz" in schema/);
    assert.match(message ?? "", /"eu"/);

    const controller = new DatabaseQueryController();
    await assert.rejects(
      controller.execute(USER, {
        query: encode(tags("zz").count() as never),
        source: "count zz",
        language: "aql",
      }),
      (error: unknown) => {
        const body = JSON.parse((error as { getBody(): string }).getBody()) as {
          message: string;
          durationMs: number;
        };
        assert.match(body.message, /Unknown instance "zz"/);
        assert.equal(typeof body.durationMs, "number");
        return true;
      },
    );
    const run = await lastRun();
    assert.equal(run?.status, "error");
    assert.match(run?.error ?? "", /Unknown instance/);
  });

  it("records a failure the console met before sending the query", async () => {
    const controller = new DatabaseQueryController();
    await controller.recordFailure(USER, {
      source: "schemas.shoop.instance()",
      language: "aql",
      error: 'Unknown schema "shoop"',
    });
    const run = await lastRun();
    assert.equal(run?.status, "error");
    assert.equal(run?.source, "schemas.shoop.instance()");
    assert.equal(run?.error, 'Unknown schema "shoop"');
  });
});
