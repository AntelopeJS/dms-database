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
import { encode } from "./stagedWire";

const SCHEMA = "query-console-qa";
const INSTANCE = "eu";
const FORGED_INSTANCE = "forged";
const USER = { _id: "query-console-user" } as User;

@RegisterTable("tags", SCHEMA)
class ConsoleTag extends Table {
  declare _id: string;
  declare label: string;
}

// Keeps the decorated class referenced: the decorator registers it.
const TABLES = [ConsoleTag];

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

// Predicate bodies that are not staged values: decoded as plain objects,
// the driver would read each as an always-true expression.
const FORGED_BODIES = [
  { label: "kept" },
  { __cls: "NoSuchClass", stages: [] },
  { __cls: "ValueProxy" },
  { stages: [] },
  { __cls: "ValueProxy", stages: [{ args: [] }] },
];

interface WireStage {
  stage: string;
  args: { args: unknown[] }[];
}

// The query's filter predicate swapped for another body.
function withPredicate(
  query: Record<string, unknown>,
  body: unknown,
): Record<string, unknown> {
  const stages = query.stages as WireStage[];
  const filter = stages.find((stage) => stage.stage === "filter");
  assert.ok(filter, "the query filters");
  filter.args[0].args[1] = body;
  return query;
}

async function assertRefused(query: Record<string, unknown>): Promise<void> {
  await assert.rejects(
    new DatabaseQueryController().execute(USER, {
      query,
      source: "forged",
      language: "aql",
    }),
    (error: { getStatus(): number; getBody(): string }) => {
      assert.equal(error.getStatus(), 400);
      const answer = JSON.parse(error.getBody()) as {
        message: string;
        durationMs: number;
      };
      assert.match(answer.message, /^Malformed query/);
      assert.equal(answer.durationMs, 0);
      return true;
    },
  );
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
});

describe("[integration] query console: malformed bodies", () => {
  before(async () => {
    await schema()
      .createInstance(FORGED_INSTANCE)
      .run()
      .catch(() => undefined);
    await tags(FORGED_INSTANCE)
      .insert([
        { _id: "f1", label: "kept" },
        { _id: "f2", label: "other" },
      ] as never)
      .run();
  });

  after(async () => {
    await schema().destroyInstance(FORGED_INSTANCE).run();
  });

  it("refuses a malformed predicate instead of writing every row", async () => {
    const before = await tags(FORGED_INSTANCE).count();
    assert.ok(before > 0, "the table holds rows to protect");
    const kept = tags(FORGED_INSTANCE).filter((row) =>
      row.key("label" as never).eq("kept"),
    );
    const writes = [
      kept.delete(),
      kept.update({ label: "overwritten" } as never),
    ];
    for (const write of writes) {
      for (const body of FORGED_BODIES) {
        await assertRefused(withPredicate(encode(write as never), body));
      }
    }
    assert.equal(await tags(FORGED_INSTANCE).count(), before);
    const overwritten = await tags(FORGED_INSTANCE)
      .filter((row) => row.key("label" as never).eq("overwritten"))
      .count();
    assert.equal(overwritten, 0);
  });
});
