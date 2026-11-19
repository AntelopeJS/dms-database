import { strict as assert } from "node:assert";
import { setTimeout as delay } from "node:timers/promises";
import { Schema } from "@antelopejs/interface-database";
import {
  EncryptionModifier,
  Encrypted,
  Field,
  HashModifier,
  Hashed,
  Index,
  LocalizationModifier,
  Localized,
  RegisterSchema,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { isJsonValue, type JsonObject, type JsonValue } from "../types/json";
import { call } from "./helpers/http";
import { at, itemsAt, keysAt, textAt } from "./helpers/pick";
import { createOwnerSession, type OwnerSession } from "./ownerSession";
import { encode } from "./stagedWire";

const SHOP = "extending-journeys-shop";
const VAULT = "extending-journeys-vault";
const PLAIN = "extending-journeys-plain";
const REGIONS = ["eu", "us"];
const SECRET_KEY = "verify-secret-key-0123456789abcd";

@RegisterTable("customers", SHOP)
class ExtendingJourneysCustomer extends Table {
  declare _id: string;
  @Index() declare email: string;
}

@RegisterTable("orders", SHOP)
class ExtendingJourneysOrder extends Table {
  declare _id: string;
  @Index() declare number: string;
  @Index()
  @Relation({ to: () => ExtendingJourneysCustomer })
  declare customer_id: string;
  @Index({ group: "status_created" }) declare status: string;
  declare total: number;
  @Index({ group: "status_created" }) declare created_at: Date;
}

@RegisterTable("products", SHOP)
class ExtendingJourneysProduct extends Table {
  declare _id: string;
  declare name: string;
  declare price: number;
  declare tags: string[];
}

@RegisterTable("accounts", VAULT)
class ExtendingJourneysAccount extends Table.with(
  HashModifier,
  EncryptionModifier,
  LocalizationModifier,
) {
  @Field("string") declare _id: string;
  @Hashed() @Field("string") declare password: string;
  @Encrypted({ secretKey: SECRET_KEY })
  @Field("string")
  declare card_number: string;
  @Localized({ fallbackLocale: "en" })
  @Field("string")
  declare display_name: string;
}

@RegisterTable("notes", PLAIN)
class ExtendingJourneysNote extends Table {
  @Field("string") declare _id: string;
}

/** Keeps the decorated classes referenced: the decorator registers them. */
const TABLES = [
  ExtendingJourneysCustomer,
  ExtendingJourneysOrder,
  ExtendingJourneysProduct,
  ExtendingJourneysAccount,
  ExtendingJourneysNote,
];

function shop() {
  const found = Schema.get(SHOP);
  assert.ok(found, "the shop schema is registered");
  return found;
}

const ROW = {
  _id: "watch-1",
  name: "Watched lamp",
  price: 12,
  tags: ["office"],
};
const OTHER_INSTANCE_ROW = {
  _id: "watch-eu",
  name: "Lamp of eu",
  price: 9,
  tags: [],
};

/** A procedure whose only node is a table watch on the default instance of the shop's products. */
const PROCEDURE = {
  name: "Watch products",
  description: "",
  graph: {
    nodes: [
      {
        id: "watch",
        kind: "trigger",
        typeId: "database.table-watch",
        config: { schema: SHOP, table: "products" },
        position: { x: 0, y: 0 },
      },
    ],
    triggerEdges: [],
    dataEdges: [],
  },
};

let owner: OwnerSession;

function automation(method: string, path: string, body?: JsonObject) {
  return call(owner, method, `/automation${path}`, body);
}

function execute(query: JsonObject, source: string) {
  return call(owner, "POST", "/database/query/execute", {
    query,
    source,
    language: "aql",
  });
}

function products(instance?: string) {
  return shop().instance(instance).table("products");
}

async function seedOrders(): Promise<void> {
  for (const region of REGIONS) {
    await shop()
      .createInstance(region)
      .run()
      .catch(() => undefined);
    await shop()
      .instance(region)
      .table("orders")
      .insert([
        {
          _id: `${region}-ord-1`,
          number: "#1",
          customer_id: `${region}-cus-1`,
          status: "paid",
          total: 10,
          created_at: new Date(Date.UTC(2026, 10, 1)),
        },
      ])
      .run();
  }
}

async function introspection(): Promise<void> {
  const answer = await call(owner, "GET", "/database/schemas");
  const schemas = itemsAt(answer.body, "schemas");
  const tableOf = (schema: string, table: string): JsonValue => {
    const found = schemas.find((row) => textAt(row, "id") === schema) ?? null;
    const tables = itemsAt(found, "tables");
    return tables.find((row) => textAt(row, "name") === table) ?? null;
  };
  const orders = tableOf(SHOP, "orders");
  const columns = keysAt(orders, "fields");
  assert.ok(
    ["_id", "number", "customer_id", "status", "total", "created_at"].every(
      (name) => columns.includes(name),
    ),
    `orders has its declared columns: ${columns.join()}`,
  );
  assert.deepEqual(
    keysAt(orders, "indexes").sort(),
    ["customer_id", "number", "status_created"],
    "an index per grouped field would list status and created_at",
  );
  assert.ok(
    itemsAt(orders, "relations").some(
      (relation) =>
        textAt(relation, "fromField") === "customer_id" &&
        textAt(relation, "toTable") === "customers",
    ),
    "orders points to customers through customer_id",
  );
  assert.deepEqual(
    at(tableOf(VAULT, "accounts"), "modifiers"),
    {
      password: ["HashModifier"],
      card_number: ["EncryptionModifier"],
      display_name: ["LocalizationModifier"],
    },
    "accounts carries hashed, encrypted and localized modifiers",
  );
  const instancesOf = async (schema: string) =>
    at(
      (await call(owner, "GET", `/database/tables/instances?schema=${schema}`))
        .body,
      "instances",
    );
  assert.deepEqual(await instancesOf(SHOP), ["eu", "us"], "eu and us");
  assert.deepEqual(await instancesOf(PLAIN), [], "no named instance");
}

/** Writes the eu row, then inserts, renames and deletes the default instance's row; each write must answer 200. */
async function writeProducts(): Promise<void> {
  const answers = [
    await execute(
      encode(products("eu").insert([OTHER_INSTANCE_ROW])),
      "insert the eu row",
    ),
    await execute(
      encode(products("eu").get(OTHER_INSTANCE_ROW._id).delete()),
      "delete the eu row",
    ),
    await execute(encode(products().insert([ROW])), "insert the row"),
    await call(
      owner,
      "PUT",
      `/database/browse/edit?filter_schema=is:${SHOP}&filter_table=is:products&id=${ROW._id}&connection=own`,
      { name: "Renamed lamp" },
    ),
    await execute(encode(products().get(ROW._id).delete()), "delete the row"),
  ];
  assert.deepEqual(
    answers.map((answer) => answer.status),
    [200, 200, 200, 200, 200],
    `the writes answer 200: ${answers.map((answer) => answer.text).join(" ")}`,
  );
}

/** The trigger payloads of a procedure's runs, oldest first, once `count` are listed or 20 s pass, then 2 s more. */
async function payloadsOf(id: string, count: number) {
  const runs = async () =>
    itemsAt((await automation("GET", `/procedures/${id}/runs`)).body);
  for (let waited = 0; waited < 20_000; waited += 1_000) {
    if ((await runs()).length >= count) break;
    await delay(1_000);
  }
  await delay(2_000);
  return Promise.all(
    (await runs()).toReversed().map(async (run) => {
      const detail = await automation("GET", `/runs/${textAt(run, "_id")}`);
      const payload: unknown = JSON.parse(
        textAt(detail.body, "triggerPayload") || "null",
      );
      const parsed = isJsonValue(payload) ? payload : null;
      return {
        type: textAt(parsed, "type"),
        old: at(parsed, "old"),
        new: at(parsed, "new"),
      };
    }),
  );
}

async function tableWatch(): Promise<void> {
  const created = await automation("POST", "/procedures/import", {
    json: JSON.stringify(PROCEDURE),
  });
  const id = textAt(created.body, "_id");
  assert.notEqual(id, "", `the import answers an id: ${created.text}`);
  try {
    const enabled = await automation("PUT", `/procedures/${id}/enabled`, {
      enabled: true,
    });
    assert.equal(enabled.status, 200, `enabling answers 200: ${enabled.text}`);
    await delay(3_000);
    await writeProducts();
    const renamed = { ...ROW, name: "Renamed lamp" };
    assert.deepEqual(
      await payloadsOf(id, 3),
      [
        { type: "insert", old: null, new: ROW },
        { type: "update", old: ROW, new: renamed },
        { type: "delete", old: renamed, new: null },
      ],
      "a watch of every instance would add the eu row's runs",
    );
  } finally {
    await automation("PUT", `/procedures/${id}/enabled`, { enabled: false });
    await automation("DELETE", `/procedures/${id}`);
  }
}

describe("[integration] extending journeys", function () {
  this.timeout(60_000);

  before(async () => {
    assert.equal(TABLES.length, 5);
    owner = await createOwnerSession("extending-journeys-owner@test.local");
    for (const id of [SHOP, VAULT, PLAIN]) await RegisterSchema(id);
    await seedOrders();
  });
  after(async () => {
    for (const region of REGIONS) await shop().destroyInstance(region).run();
    await shop().instance().table("products").delete().run();
    await owner.remove();
  });

  it(
    "a-registered-schema-shows-its-tables-columns-indexes-relations-and-modifiers",
    introspection,
  );
  it(
    "the-table-watch-hands-a-procedure-each-insert-update-and-delete",
    tableWatch,
  );
});
