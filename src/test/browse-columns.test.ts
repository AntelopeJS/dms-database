import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import {
  Index,
  RegisterSchema,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { DatabaseBrowseController } from "../routes/data";

const SCHEMA = "browse-columns-qa";
const USER = Object.assign(new User(), { _id: "browse-columns-user" });

@RegisterTable("orders", SCHEMA)
class BrowseColumnsOrder extends Table {
  declare _id: string;
  @Index() declare number: string;
  @Index() declare customer_id: string;
  declare total: number;
}

/** Keeps the decorated class referenced: the decorator registers it. */
const TABLES = [BrowseColumnsOrder];

interface PlainRow {
  _id: string;
  name: string;
  rank: number;
}

const plain = new Schema<{ rows: PlainRow }>(`${SCHEMA}-plain`, {
  rows: {
    fields: { _id: "string", name: "string", rank: "number" },
    indexes: {},
  },
});

function orders() {
  const schema = Schema.get<{ orders: BrowseColumnsOrder }>(SCHEMA);
  assert.ok(schema, "the test schema is registered");
  return schema.instance().table("orders");
}

describe("[integration] browse columns: declared order", () => {
  before(async () => {
    assert.equal(TABLES.length, 1);
    await RegisterSchema(SCHEMA);
    await orders()
      .insert([
        { total: 12, customer_id: "c1", number: "N-1", _id: "o1" },
        { note: "gift", total: 7, customer_id: "c2", number: "N-2", _id: "o2" },
      ])
      .run();
  });

  after(async () => {
    await orders().delete().run();
    await plain.instance().table("rows").delete().run();
  });

  it("lists the declared fields in declaration order, then the sampled extras", async () => {
    const meta = await new DatabaseBrowseController().columns(
      USER,
      `is:${SCHEMA}`,
      undefined,
      "is:orders",
    );
    assert.deepEqual(meta.columns, [
      "_id",
      "number",
      "customer_id",
      "total",
      "_instance",
      "note",
    ]);
  });

  it("orders an undecorated table by its schema definition's fields", async () => {
    await plain
      .instance()
      .table("rows")
      .insert([{ zeta: true, rank: 1, name: "a", _id: "r1" }])
      .run();
    const meta = await new DatabaseBrowseController().columns(
      USER,
      `is:${SCHEMA}-plain`,
      undefined,
      "is:rows",
    );
    assert.deepEqual(meta.columns, [
      "_id",
      "name",
      "rank",
      "zeta",
      "_instance",
    ]);
  });
});
