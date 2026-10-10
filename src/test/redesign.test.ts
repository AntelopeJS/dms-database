import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import {
  GetModel,
  Index,
  RegisterSchema,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { QueryHistoryModel } from "../db";
import { DatabaseBrowseController } from "../routes/data";
import { DatabaseQueryController } from "../routes/query";
import { DatabaseTablesController } from "../routes/tables";
import { listRecentQueries, listSchemaCards } from "../service/overview";
import {
  containsMutation,
  describeUnknownQueryTarget,
  dryRun,
  readQueryTarget,
} from "../service/queryInspection";
import { listRowReferences } from "../service/references";
import { encode } from "./stagedWire";

const SCHEMA = "redesign-shop";
const INSTANCE = "eu";
const USER = { _id: "redesign-user", language: "fr" } as User;

@RegisterTable("customers", SCHEMA)
class RedesignCustomer extends Table {
  declare _id: string;
  @Index() declare company: string;
}

@RegisterTable("orders", SCHEMA)
class RedesignOrder extends Table {
  declare _id: string;
  @Relation({ to: () => RedesignCustomer }) declare customer_id: string;
  declare status: string;
  declare created_at: Date;
}

// Keeps the decorated classes referenced: the decorators register them.
const TABLES = [RedesignCustomer, RedesignOrder];

function shop() {
  const schema = Schema.get(SCHEMA);
  assert.ok(schema, "the test schema is registered");
  return schema;
}

async function seed(): Promise<void> {
  assert.equal(TABLES.length, 2);
  await RegisterSchema(SCHEMA);
  const instance = shop().instance(INSTANCE);
  await shop()
    .createInstance(INSTANCE)
    .run()
    .catch(() => undefined);
  await instance
    .table("customers" as never)
    .insert([
      { _id: "c1", company: "Globex" },
      { _id: "c2", company: "Initech" },
    ] as never)
    .run();
  await instance
    .table("orders" as never)
    .insert([
      {
        _id: "o1",
        customer_id: "c1",
        status: "pending",
        created_at: new Date("2026-10-01T10:00:00Z"),
      },
      {
        _id: "o2",
        customer_id: "c1",
        status: "paid",
        created_at: new Date("2026-10-02T10:00:00Z"),
      },
      {
        _id: "o3",
        customer_id: "c2",
        status: "pending",
        created_at: new Date("2026-10-03T10:00:00Z"),
      },
    ] as never)
    .run();
}

async function cleanUp(): Promise<void> {
  await shop().destroyInstance(INSTANCE).run();
  await GetModel(QueryHistoryModel)
    .table.filter((d) => d.key("userId").eq(USER._id))
    .delete()
    .run();
}

// One seed for both suites: mocha runs every root `before` first.
before(seed);
after(cleanUp);

describe("[integration] v2 redesign: browsing", () => {
  it("finds a table by one of its column names and filters on the schema", async () => {
    const controller = new DatabaseTablesController();
    const list = (q?: string, scope?: string, has?: string) =>
      controller.source(USER, scope, undefined, q, has);
    const byColumn = await list("is:customer_id", `is:${SCHEMA}`);
    assert.deepEqual(
      byColumn.results.map((row) => row.name),
      ["orders"],
    );
    assert.deepEqual(byColumn.results[0]?.relations, ["customers"]);
    const withRelations = await list(undefined, `is:${SCHEMA}`, "is:relations");
    assert.ok(withRelations.results.every((row) => row.relations.length > 0));
    assert.ok(withRelations.results.some((row) => row.name === "orders"));
    const other = await list(undefined, "is:no-such-schema");
    assert.equal(other.total, 0);
  });
  it("counts the rows of other tables pointing at a row", async () => {
    const [orders] = await listRowReferences(
      SCHEMA,
      "customers",
      { _id: "c1" },
      INSTANCE,
    );
    assert.deepEqual(orders, {
      schema: SCHEMA,
      table: "orders",
      field: "customer_id",
      many: false,
      count: 2,
    });
  });
  it("clears a field with null and keeps a date cell a date", async () => {
    const controller = new DatabaseBrowseController();
    const selection = [
      `is:${SCHEMA}`,
      `is:${INSTANCE}`,
      "is:orders",
      "o3",
    ] as const;
    await controller.edit(USER, ...selection, {
      status: null,
      created_at: "2026-10-05T08:00:00.000Z",
    });
    const row = (await shop()
      .instance(INSTANCE)
      .table("orders" as never)
      .get("o3" as never)) as Record<string, unknown>;
    assert.equal(row.status, null);
    assert.ok(row.created_at instanceof Date);
    assert.equal(
      (row.created_at as Date).toISOString(),
      "2026-10-05T08:00:00.000Z",
    );
  });
  it("refuses a value that is not a date for a date cell", async () => {
    const controller = new DatabaseBrowseController();
    await assert.rejects(
      controller.edit(
        USER,
        `is:${SCHEMA}`,
        `is:${INSTANCE}`,
        "is:orders",
        "o3",
        {
          created_at: "not a date",
        },
      ),
      (error: { getStatus(): number }) => error.getStatus() === 400,
    );
  });
  it("describes each schema as a card in the reader's language", async () => {
    const card = (await listSchemaCards(USER)).find(
      (item) => item.id === SCHEMA,
    );
    assert.ok(card);
    assert.equal(card.tag, "2 instances");
    assert.deepEqual(card.readout, ["2 tables · 0 lignes", "1 relation"]);
  });
});

describe("[integration] v2 redesign: queries", () => {
  it("measures what a write would touch without writing", async () => {
    const orders = shop()
      .instance(INSTANCE)
      .table("orders" as never);
    const deletion = orders
      .filter((row) => row.key("customer_id" as never).eq("c1"))
      .delete();
    assert.equal(containsMutation(deletion), true);
    assert.deepEqual(await dryRun(deletion), {
      schema: SCHEMA,
      instance: INSTANCE,
      table: "orders",
      operation: "delete",
      rows: 2,
    });
    const single = orders
      .get("o2" as never)
      .update({ status: "refunded" } as never);
    assert.equal((await dryRun(single)).rows, 1);
    assert.equal(await orders.count(), 3, "a dry run writes nothing");
    const read = await dryRun(orders.slice(0, 1));
    assert.equal(read.operation, "read");
  });
  it("names an unknown table instead of answering no row", async () => {
    const target = readQueryTarget(
      shop()
        .instance()
        .table("invoice" as never),
    );
    assert.equal(
      await describeUnknownQueryTarget(target),
      `Unknown table "invoice" in schema ${SCHEMA}`,
    );
    const controller = new DatabaseQueryController();
    const source = `schemas["${SCHEMA}"].instance().table("invoice")`;
    await assert.rejects(
      controller.execute(USER, {
        query: encode(
          shop()
            .instance()
            .table("invoice" as never) as never,
        ),
        source,
        language: "aql",
      }),
    );
    const { items } = await GetModel(QueryHistoryModel).listForUser(
      USER._id,
      1,
      0,
    );
    assert.equal(items[0]?.status, "error");
    assert.match(items[0]?.error ?? "", /Unknown table/);
  });
  it("records a run and lists it as a recent query", async () => {
    const controller = new DatabaseQueryController();
    const result = await controller.execute(USER, {
      query: encode(
        shop()
          .instance(INSTANCE)
          .table("orders" as never) as never,
      ),
      source: "orders",
      language: "aql",
    });
    assert.equal(result.rowCount, 3);
    assert.equal(result.truncated, false);
    assert.equal(result.mutation, false);
    const [recent] = await listRecentQueries(USER._id);
    assert.equal(recent?.title, "orders");
    assert.equal(recent?.tone, "success");
  });
});
