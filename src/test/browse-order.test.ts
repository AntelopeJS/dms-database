import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import {
  RegisterSchema,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { DatabaseBrowseController } from "../routes/data";
import { requestContext } from "./requestContext";

const SCHEMA = "browse-order-shop";
const INSTANCE = "eu";
const USER = Object.assign(new User(), { _id: "browse-order-user" });
const INSERTED_IDS = ["ord-3", "ord-1", "ord-4", "ord-2"];
const KEY_ORDER = ["ord-1", "ord-2", "ord-3", "ord-4"];

@RegisterTable("orders", SCHEMA)
class BrowseOrderOrder extends Table {
  declare _id: string;
  declare status: string;
}

/** Keeps the decorated class referenced: the decorator registers it. */
const TABLES = [BrowseOrderOrder];

function shop() {
  const schema = Schema.get<{ orders: BrowseOrderOrder }>(SCHEMA);
  assert.ok(schema, "the test schema is registered");
  return schema;
}

async function listIds(offset: number, limit: number, search = "") {
  const result = await new DatabaseBrowseController().list(
    USER,
    requestContext("https://example.test/"),
    `is:${SCHEMA}`,
    `is:${INSTANCE}`,
    "is:orders",
    String(offset),
    String(limit),
    "",
    "",
    search,
  );
  return result.results.map<unknown>((row) => row._id);
}

describe("[integration] unsorted browse order", () => {
  before(async () => {
    assert.equal(TABLES.length, 1);
    await RegisterSchema(SCHEMA);
    await shop()
      .createInstance(INSTANCE)
      .run()
      .catch(() => undefined);
    await shop()
      .instance(INSTANCE)
      .table("orders")
      .insert(INSERTED_IDS.map((_id) => ({ _id, status: "open" })))
      .run();
  });

  after(async () => {
    await shop().destroyInstance(INSTANCE).run();
  });

  it("pages an unsorted table in primary key order, not store order", async () => {
    assert.deepEqual(
      [...(await listIds(0, 2)), ...(await listIds(2, 2))],
      KEY_ORDER,
    );
  });

  it("orders an unsorted search by primary key", async () => {
    assert.deepEqual(await listIds(0, 10, "open"), KEY_ORDER);
  });

  it("keeps an edited row in its place", async () => {
    await new DatabaseBrowseController().edit(
      USER,
      `is:${SCHEMA}`,
      `is:${INSTANCE}`,
      "is:orders",
      "ord-1",
      { status: "shipped" },
    );
    assert.deepEqual(await listIds(0, 10), KEY_ORDER);
  });
});
