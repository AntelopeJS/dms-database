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
import { User } from "@antelopejs/interface-dms/auth/db";
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
import { requestContext } from "./requestContext";
import { encode } from "./stagedWire";

const SCHEMA = "redesign-shop";
const INSTANCE = "eu";
const USER = Object.assign(new User(), {
  _id: "redesign-user",
  language: "fr",
});

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

/** Keeps the decorated classes referenced: the decorators register them. */
const TABLES = [RedesignCustomer, RedesignOrder];

function shop() {
  const schema = Schema.get<{
    customers: RedesignCustomer;
    orders: RedesignOrder;
  }>(SCHEMA);
  assert.ok(schema, "the test schema is registered");
  return schema;
}

function unknownTableShop() {
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
    .table("customers")
    .insert([
      { _id: "c1", company: "Globex" },
      { _id: "c2", company: "Initech" },
    ])
    .run();
  await instance
    .table("orders")
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
    ])
    .run();
}

async function cleanUp(): Promise<void> {
  await shop().destroyInstance(INSTANCE).run();
  await GetModel(QueryHistoryModel)
    .table.filter((d) => d.key("userId").eq(USER._id))
    .delete()
    .run();
}

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
  it("reads one table of the source by its id, as the filter bar's list does", async () => {
    const controller = new DatabaseTablesController();
    const row = await controller.sourceRow(USER, `${SCHEMA}::orders`);
    const [listed] = (
      await controller.source(
        USER,
        `is:${SCHEMA}`,
        undefined,
        "is:orders",
        undefined,
      )
    ).results.filter((candidate) => candidate.name === "orders");
    assert.deepEqual(row, listed);
    await assert.rejects(
      controller.sourceRow(USER, `${SCHEMA}::no_such_table`),
    );
    await assert.rejects(controller.sourceRow(USER, undefined));
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
    const row = await shop().instance(INSTANCE).table("orders").get("o3");
    assert.equal(row.status, null);
    assert.ok(row.created_at instanceof Date);
    assert.equal(row.created_at.toISOString(), "2026-10-05T08:00:00.000Z");
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
  it("describes each schema as a card the dashboard composes", async () => {
    const card = (await listSchemaCards()).find((item) => item.id === SCHEMA);
    assert.ok(card);
    const key = (name: string) => `$dms_database.overview.schemas.card.${name}`;
    assert.equal(card.to, `/modules/database/schemas?scope=${SCHEMA}`);
    assert.deepEqual(card.tag, {
      key: key("instances"),
      params: { count: { type: "count", value: 2 } },
    });
    assert.deepEqual(card.readout, [
      {
        key: key("contents"),
        params: {
          tables: {
            key: key("tables"),
            params: { count: { type: "count", value: 2 } },
          },
          rows: {
            key: key("rows"),
            params: { count: { type: "number", value: 0, format: "compact" } },
            plural: "count",
          },
        },
      },
      {
        key: key("relations"),
        params: { count: { type: "count", value: 1 } },
      },
    ]);
  });
});

describe("[integration] v2 redesign: edits", () => {
  it("answers an edit with the row as the listing then serves it", async () => {
    const controller = new DatabaseBrowseController();
    const table = [`is:${SCHEMA}`, `is:${INSTANCE}`, "is:orders"] as const;
    const orders = shop().instance(INSTANCE).table("orders");
    const listed = async (id: string): Promise<string> => {
      const page = await controller.list(
        USER,
        requestContext("https://example.test/"),
        ...table,
        "0",
        "50",
        undefined,
        undefined,
        undefined,
      );
      return JSON.stringify(
        page.results.find((row: { _id: string }) => row._id === id),
      );
    };
    const before = await orders.get("o2");
    try {
      const answer: unknown = await controller.edit(USER, ...table, "o2", {
        status: "shipped",
        created_at: "2026-10-06T09:00:00.000Z",
        notes: { gift: true, tags: ["red"] },
      });
      assert.deepEqual(
        JSON.parse(JSON.stringify(answer)),
        JSON.parse(await listed("o2")),
      );
      assert.equal(
        JSON.parse(JSON.stringify(answer)).created_at,
        "2026-10-06T09:00:00.000Z",
      );
      const unchanged: unknown = await controller.edit(USER, ...table, "o2", {
        status: "shipped",
      });
      assert.deepEqual(
        JSON.parse(JSON.stringify(unchanged)),
        JSON.parse(await listed("o2")),
      );
      const cleared: unknown = await controller.edit(USER, ...table, "o2", {
        notes: null,
      });
      assert.deepEqual(
        JSON.parse(JSON.stringify(cleared)),
        JSON.parse(await listed("o2")),
      );
    } finally {
      await orders.get("o2").replace(before).run();
    }
  });
});

describe("[integration] v2 redesign: queries", () => {
  it("measures what a write would touch without writing", async () => {
    const orders = shop().instance(INSTANCE).table("orders");
    const deletion = orders
      .filter((row) => row.key("customer_id").eq("c1"))
      .delete();
    assert.equal(containsMutation(deletion), true);
    assert.deepEqual(await dryRun(deletion), {
      schema: SCHEMA,
      instance: INSTANCE,
      table: "orders",
      operation: "delete",
      rows: 2,
    });
    const single = orders.get("o2").update({ status: "refunded" });
    assert.equal((await dryRun(single)).rows, 1);
    assert.equal(await orders.count(), 3, "a dry run writes nothing");
    const read = await dryRun(orders.slice(0, 1));
    assert.equal(read.operation, "read");
  });
  it("names an unknown table instead of answering no row", async () => {
    const target = readQueryTarget(
      unknownTableShop().instance().table("invoice"),
    );
    assert.equal(
      await describeUnknownQueryTarget(target),
      `Unknown table "invoice" in schema ${SCHEMA}`,
    );
    const controller = new DatabaseQueryController();
    const source = `schemas["${SCHEMA}"].instance().table("invoice")`;
    await assert.rejects(
      controller.execute(USER, {
        query: encode(unknownTableShop().instance().table("invoice")),
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
      query: encode(shop().instance(INSTANCE).table("orders")),
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
