import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import {
  EncryptionModifier,
  Encrypted,
  Field,
  HashModifier,
  Hashed,
  RegisterSchema,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import type { ExecutionCtx } from "@antelopejs/interface-dms-automation";
import { countRowsAction, getRowAction } from "../automation/rowActions";

const SCHEMA = "row-actions";
const VAULT = "row-actions-vault";
const TENANTS = ["row-a", "row-b"];

const schema = new Schema<{
  orders: { _id: string; status: string; customer: string; placed: Date };
}>(SCHEMA, {
  orders: {
    fields: {
      _id: "string",
      status: "string",
      customer: "string",
      placed: "date",
    },
    indexes: {},
  },
});

@RegisterTable("accounts", VAULT)
class RowActionsAccount extends Table.with(HashModifier, EncryptionModifier) {
  @Field("string") declare _id: string;
  @Field("string") declare handle: string;
  @Hashed() @Field("string") declare password: string;
  @Encrypted({ secretKey: "row-actions-secret-key-0123456789" })
  @Field("string")
  declare card: string;
}

const CTX: ExecutionCtx = {
  procedureId: "row-actions",
  runId: "run",
  nodeId: "read",
  log: () => undefined,
};

const PLACED = new Date("2026-11-02T09:30:00.000Z");

function getRowTests(): void {
  it("reads a row of the default instance as JSON, a date as its ISO string, with the table's key", async () => {
    assert.deepEqual(
      await getRowAction.execute(
        { schema: SCHEMA, table: "orders", id: "o1" },
        CTX,
      ),
      {
        found: true,
        row: {
          _id: "o1",
          status: "paid",
          customer: "Ada Lovelace",
          placed: "2026-11-02T09:30:00.000Z",
        },
        primaryKey: null,
      },
    );
  });

  it("reads a row of the named instance only, without the instance tag", async () => {
    const answer = await getRowAction.execute(
      { schema: SCHEMA, instance: "row-a", table: "orders", id: "a1" },
      CTX,
    );
    assert.equal(answer.row?.customer, "Tenant A");
    assert.equal(answer.row && Object.hasOwn(answer.row, "_instance"), false);
    const elsewhere = await getRowAction.execute(
      { schema: SCHEMA, instance: "row-b", table: "orders", id: "a1" },
      CTX,
    );
    assert.equal(elsewhere.found, false);
    const fallback = await getRowAction.execute(
      { schema: SCHEMA, table: "orders", id: "a1" },
      CTX,
    );
    assert.equal(fallback.found, false);
  });

  it("answers found false for a missing key", async () => {
    assert.deepEqual(
      await getRowAction.execute(
        { schema: SCHEMA, table: "orders", id: "none" },
        CTX,
      ),
      { found: false, row: null, primaryKey: null },
    );
  });

  it("leaves out hashed and encrypted fields, top level and locked, and keeps the rest", async () => {
    const answer = await getRowAction.execute(
      { schema: VAULT, table: "accounts", id: "acc1" },
      CTX,
    );
    assert.deepEqual(answer.row, {
      _id: "acc1",
      handle: "ada",
      _internal: { meta: {}, data: {} },
    });
    assert.equal(answer.primaryKey, "_id");
  });

  it("refuses an instance the schema does not list, and a named instance on an external database", async () => {
    await assert.rejects(
      getRowAction.execute(
        { schema: SCHEMA, instance: "row-z", table: "orders", id: "o1" },
        CTX,
      ),
      { message: /^Unknown instance "row-z" in schema row-actions/ },
    );
    await assert.rejects(
      getRowAction.execute(
        {
          connection: "erp",
          schema: "erp",
          instance: "eu",
          table: "customers",
          id: "c1",
        },
        CTX,
      ),
      { message: "erp has no instances: read its tables without one" },
    );
  });

  it("reads a row of an external database", async () => {
    const answer = await getRowAction.execute(
      { connection: "erp", schema: "erp", table: "customers", id: "c1" },
      CTX,
    );
    assert.equal(answer.found, true);
    assert.equal(answer.row?.name, "Ada");
  });

  it("fails with the service's message, not [object Object], on an unknown table or connection", async () => {
    await assert.rejects(
      getRowAction.execute({ schema: SCHEMA, table: "nope", id: "o1" }, CTX),
      { message: "Unknown table: nope" },
    );
    await assert.rejects(
      getRowAction.execute(
        { connection: "nowhere", schema: SCHEMA, table: "orders", id: "o1" },
        CTX,
      ),
      { message: 'Unknown connection "nowhere"' },
    );
  });
}

function countRowsTests(): void {
  const count = async (input: Parameters<typeof countRowsAction.execute>[0]) =>
    (
      await countRowsAction.execute(
        { schema: SCHEMA, table: "orders", ...input },
        CTX,
      )
    ).count;

  it("counts the default instance, one named instance, and every instance", async () => {
    assert.equal(await count({}), 3);
    assert.equal(await count({ instance: "row-b" }), 2);
    assert.equal(await count({ allInstances: true }), 6);
  });

  it("ANDs the is and contains filters, and ORs the search over columns", async () => {
    assert.equal(await count({ filters: { status: "is:paid" } }), 2);
    assert.equal(
      await count({ filters: { status: "paid", customer: "contains:ada" } }),
      1,
    );
    assert.equal(await count({ search: "hopper" }), 1);
  });

  it("refuses an unknown column, an unknown mode and a filter on a date column", async () => {
    await assert.rejects(count({ filters: { colour: "is:red" } }), {
      message: "Unknown column: colour",
    });
    await assert.rejects(count({ filters: { status: "near:paid" } }), {
      message:
        'Filter on status has an unknown mode "near": write is:<text> or contains:<text>',
    });
    await assert.rejects(count({ filters: { placed: "is:2026" } }));
  });

  it("refuses every instance on an external database, and counts its default one", async () => {
    await assert.rejects(
      countRowsAction.execute(
        {
          connection: "erp",
          schema: "erp",
          table: "customers",
          allInstances: true,
        },
        CTX,
      ),
      {
        message:
          "erp has no instances: count its tables without every instance",
      },
    );
    const { count: external } = await countRowsAction.execute(
      {
        connection: "erp",
        schema: "erp",
        table: "customers",
        filters: { _id: "is:c2" },
      },
      CTX,
    );
    assert.equal(external, 1);
  });
}

describe("[integration] the row actions", () => {
  before(async () => {
    assert.ok(RowActionsAccount);
    const orders = (instance?: string) =>
      schema.instance(instance).table("orders");
    for (const tenant of TENANTS) await schema.createInstance(tenant).run();
    await orders()
      .insert([
        { _id: "o1", status: "paid", customer: "Ada Lovelace", placed: PLACED },
        { _id: "o2", status: "paid", customer: "Grace Hopper", placed: PLACED },
        { _id: "o3", status: "open", customer: "Ada Byron", placed: PLACED },
      ])
      .run();
    await orders("row-a")
      .insert({
        _id: "a1",
        status: "open",
        customer: "Tenant A",
        placed: PLACED,
      })
      .run();
    await orders("row-b")
      .insert([
        { _id: "b1", status: "open", customer: "Tenant B", placed: PLACED },
        { _id: "b2", status: "paid", customer: "Tenant B", placed: PLACED },
      ])
      .run();
    await RegisterSchema(VAULT);
    const vault = Schema.get(VAULT);
    assert.ok(vault);
    await vault
      .instance()
      .table("accounts")
      .insert({
        _id: "acc1",
        handle: "ada",
        password: "plain-copy",
        card: "plain-card",
        _internal: { meta: {}, data: { password: "$hash", card: "cipher" } },
      })
      .run();
  });

  after(async () => {
    for (const tenant of TENANTS) await schema.destroyInstance(tenant).run();
    await schema.instance().table("orders").delete().run();
  });

  describe("get-row", () => {
    getRowTests();
  });

  describe("count-rows", () => {
    countRowsTests();
  });
});
