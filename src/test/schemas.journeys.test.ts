import { strict as assert } from "node:assert";
import type { JsonValue } from "../types/json";
import { call } from "./helpers/http";
import { at, itemsAt, keysAt, textAt } from "./helpers/jsonAt";
import {
  CUSTOMERS_PER_REGION,
  DEMO,
  EXPECTED_FIGURES,
  HOLLOW,
  LINKS,
  METRICS,
  ORDERS_PER_REGION,
  QUIRKS,
  SHOP,
  VAULT,
  cleanUp,
  seed,
} from "./helpers/schemasPlayground";
import {
  createMemberSession,
  createOwnerSession,
  type OwnerSession,
} from "./ownerSession";

interface Listing {
  status: number;
  rows: JsonValue[];
  total: JsonValue;
  all: JsonValue;
}

interface Bar {
  scope?: string;
  instance?: string;
  q?: string;
  has?: string;
}

let owner: OwnerSession;
let member: OwnerSession;

const ids = (rows: JsonValue[]): string[] =>
  rows.map((row) => textAt(row, "id"));
const rowOf = (rows: JsonValue[], id: string): JsonValue =>
  rows.find((row) => textAt(row, "id") === id) ?? null;

/** The tables the Schemas page lists for a filter bar state, as its table view asks for them. */
async function source(bar: Bar = {}): Promise<Listing> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(bar))
    if (value) query.set(`filter_${key}`, `is:${value}`);
  const search = query.size > 0 ? `?${query.toString()}` : "";
  const answer = await call(owner, "GET", `/database/tables/source${search}`);
  return {
    status: answer.status,
    rows: itemsAt(answer.body, "results"),
    total: at(answer.body, "total"),
    all: at(answer.body, "all"),
  };
}

async function listed(bar: Bar): Promise<string[]> {
  return ids((await source(bar)).rows).sort();
}

async function schemas(): Promise<JsonValue[]> {
  const answer = await call(owner, "GET", "/database/schemas");
  return itemsAt(answer.body, "schemas");
}

function schemaOf(all: JsonValue[], schemaId: string): JsonValue {
  return all.find((entry) => textAt(entry, "id") === schemaId) ?? null;
}

function tableOf(all: JsonValue[], schemaId: string, table: string): JsonValue {
  const tables = itemsAt(schemaOf(all, schemaId), "tables");
  return tables.find((entry) => textAt(entry, "name") === table) ?? null;
}

function instances(query: string) {
  return call(owner, "GET", `/database/tables/instances?${query}`);
}

function singleRow(query: string) {
  return call(owner, "GET", `/database/tables/source/row${query}`);
}

async function tableCounts(): Promise<void> {
  const listing = await source();
  const registered = (await schemas()).reduce<number>(
    (sum, entry) => sum + itemsAt(entry, "tables").length,
    0,
  );
  assert.equal(listing.status, 200);
  assert.equal(listing.total, listing.rows.length, "total is the rows listed");
  assert.deepEqual(
    [listing.all, listing.rows.length],
    [registered, registered],
    "all counting one schema's tables would not match the schemas route",
  );
  const listedIds = ids(listing.rows);
  assert.equal(new Set(listedIds).size, listedIds.length, "ids are unique");
  assert.ok(
    listedIds.every((id) => id.split("::").length === 2),
    "every id is schema::table",
  );
  assert.ok(
    listing.rows.every(
      (row) =>
        textAt(row, "id") ===
        `${textAt(row, "schema")}::${textAt(row, "name")}`,
    ),
    "every row names its schema and table",
  );
  for (const [id, expected] of EXPECTED_FIGURES) {
    const row = rowOf(listing.rows, id);
    assert.deepEqual(
      {
        rows: at(row, "elementCount"),
        columns: at(row, "columnCount"),
        indexes: at(row, "indexCount"),
        relations: at(row, "relations"),
        modifiers: at(row, "modifiers"),
      },
      expected,
      `${id} holds its figures`,
    );
  }
}

async function filters(): Promise<void> {
  const everything = await source();
  const shop = await source({ scope: SHOP });
  const none = await source({ scope: "nope" });
  const byName = await listed({ scope: SHOP, q: "ORDER" });
  const orderTables = [`${SHOP}::order_items`, `${SHOP}::orders`];
  assert.deepEqual(
    [everything.total, everything.rows.length],
    [everything.all, everything.all],
    "unfiltered lists every table",
  );
  assert.deepEqual(
    ids(shop.rows).sort(),
    [`${SHOP}::customers`, ...orderTables, `${SHOP}::products`],
    "a schema lists its own tables only",
  );
  assert.deepEqual(
    [shop.total, shop.all],
    [4, everything.all],
    "the schema filter leaves all as the registered count",
  );
  assert.deepEqual(
    [none.total, none.rows.length, none.all],
    [0, 0, everything.all],
    "an unknown schema lists nothing",
  );
  assert.deepEqual(byName, orderTables, "a name matches in any case");
  assert.deepEqual(
    await listed({ scope: SHOP, q: "  order  " }),
    byName,
    "a search is trimmed",
  );
  assert.deepEqual(
    await listed({ scope: SHOP, q: "email" }),
    [`${SHOP}::customers`],
    "a column name finds its table",
  );
  assert.deepEqual(
    await listed({ scope: SHOP, q: "customer" }),
    [`${SHOP}::customers`, `${SHOP}::orders`],
    "a search names the table or a column",
  );
  assert.deepEqual(
    await listed({ scope: SHOP, q: "customer_id" }),
    [`${SHOP}::orders`],
    "a column name is not a table name",
  );
  assert.deepEqual(
    await listed({ q: "tail_marker" }),
    [`${VAULT}::wide_records`],
    "a search of the first twelve columns only would miss the seventeenth",
  );
}

async function structureFilters(): Promise<void> {
  const orderTables = [`${SHOP}::order_items`, `${SHOP}::orders`];
  const related = await listed({ scope: SHOP, has: "relations" });
  assert.deepEqual(related, orderTables, "relations keeps the related tables");
  assert.deepEqual(
    await listed({ scope: VAULT, has: "modifiers" }),
    [`${VAULT}::accounts`],
    "modifiers keeps the tables with hashed, localized or encrypted columns",
  );
  assert.equal(
    (await source({ scope: VAULT, has: "relations,modifiers" })).total,
    0,
    "both structure flags must hold",
  );
  assert.deepEqual(
    await listed({ scope: SHOP, has: "relations, bogus" }),
    related,
    "an unknown flag is ignored among known ones",
  );
  assert.equal(
    (await source({ scope: SHOP, has: "bogus" })).total,
    4,
    "only an unknown flag filters nothing",
  );
  assert.deepEqual(
    await listed({ scope: SHOP, has: "empty" }),
    [`${SHOP}::customers`, ...orderTables],
    "empty keeps the tables without a row in the default instance",
  );
  assert.deepEqual(
    await listed({ scope: SHOP, q: "order", has: "relations,empty" }),
    orderTables,
    "search, relations and empty combine",
  );
  assert.deepEqual(
    await listed({ scope: VAULT, has: "modifiers,empty" }),
    [],
    "modifiers and empty combine: accounts holds two rows",
  );
}

async function sourceFilters(): Promise<void> {
  await filters();
  await structureFilters();
}

async function shopCounts(instance?: string) {
  const { rows } = await source({ scope: SHOP, instance });
  return Object.fromEntries(
    rows.map((row) => [textAt(row, "name"), at(row, "elementCount")]),
  );
}

async function instanceCounts(): Promise<void> {
  const perRegion = {
    customers: CUSTOMERS_PER_REGION,
    products: 6,
    orders: ORDERS_PER_REGION,
    order_items: ORDERS_PER_REGION * 2,
  };
  assert.deepEqual(
    await shopCounts(),
    { customers: 0, products: 6, orders: 0, order_items: 0 },
    "no instance counts the default one",
  );
  assert.deepEqual(await shopCounts("eu"), perRegion, "eu counts its rows");
  assert.deepEqual(await shopCounts("us"), perRegion, "us counts its rows");
  assert.deepEqual(
    await shopCounts("all"),
    {
      customers: CUSTOMERS_PER_REGION * 2,
      products: 18,
      orders: ORDERS_PER_REGION * 2,
      order_items: ORDERS_PER_REGION * 4,
    },
    "all counts every instance at once",
  );
  assert.ok(
    Object.values(await shopCounts("atlantis")).every((count) => count === 0),
    "an instance that does not exist counts nothing",
  );
  const emptyIn = async (instance: string) =>
    (await source({ scope: SHOP, instance, has: "empty" })).total;
  assert.deepEqual(
    [await emptyIn("eu"), await emptyIn("all")],
    [0, 0],
    "empty judged in the default instance would keep three shop tables",
  );
  assert.deepEqual(
    await listed({ scope: METRICS, instance: "eu", has: "empty" }),
    [`${METRICS}::empty_log`, `${METRICS}::readings`],
    "empty in eu keeps both metrics tables",
  );
  const row = await singleRow(`?id=${SHOP}::orders`);
  assert.deepEqual(
    [
      at(row.body, "elementCount"),
      at(row.body, "id"),
      at(row.body, "columnCount"),
    ],
    [0, `${SHOP}::orders`, 10],
    "a single row is counted in the default instance",
  );
}

async function instanceSearch(): Promise<void> {
  const named = async (query: string) =>
    at((await instances(query)).body, "instances");
  assert.deepEqual(
    (await instances(`schema=${SHOP}`)).body,
    { instances: ["eu", "us"], total: 2 },
    "shop has eu and us",
  );
  assert.deepEqual(
    [
      await named(`schema=${SHOP}&search=E`),
      await named(`schema=${SHOP}&search=S`),
    ],
    [["eu"], ["us"]],
    "a search matches part of a name in any case",
  );
  assert.deepEqual(
    (await instances(`schema=${SHOP}&search=zzz`)).body,
    { instances: [], total: 0 },
    "a search with no match is empty",
  );
  const tenants = ["tenant-1", "tenant-2", "tenant-10"];
  assert.deepEqual(
    await named(`schema=${LINKS}`),
    tenants,
    "a sort by text would put tenant-10 before tenant-2",
  );
  assert.deepEqual(
    (await instances(`schema=${LINKS}&limit=2`)).body,
    { instances: tenants.slice(0, 2), total: 3 },
    "the limit cuts the list and total says how many matched",
  );
  assert.deepEqual(
    (await instances(`schema=${LINKS}&limit=0`)).body,
    { instances: tenants.slice(0, 1), total: 3 },
    "a limit under 1 is read as 1",
  );
  assert.deepEqual(
    (await instances(`schema=${LINKS}&limit=abc`)).body,
    { instances: tenants, total: 3 },
    "an unreadable limit falls back to the default of 100",
  );
  const ceiling = await instances(`schema=${LINKS}&limit=9999`);
  assert.deepEqual(
    [ceiling.status, at(ceiling.body, "total")],
    [200, 3],
    "a large limit is clamped, not refused",
  );
  assert.deepEqual(
    (await instances(`schema=${METRICS}`)).body,
    { instances: [], total: 0 },
    "a schema without named instances lists none",
  );
  assert.equal((await instances("schema=nope")).status, 404, "unknown: 404");
  assert.equal((await instances("")).status, 400, "missing schema: 400");
}

async function singleTable(): Promise<void> {
  const found = await singleRow(`?id=${VAULT}::wide_records`);
  assert.deepEqual(
    ["schema", "name", "elementCount", "columnCount", "indexCount"].map((key) =>
      at(found.body, key),
    ),
    [VAULT, "wide_records", 1, 17, 0],
    "the row holds the table's figures",
  );
  assert.deepEqual(
    at(found.body, "relations"),
    ["parents_registry"],
    "a relation inside the schema is named without it",
  );
  const related = await singleRow(`?id=${LINKS}::customer_refs`);
  assert.deepEqual(
    at(related.body, "relations"),
    [`${SHOP}.customers`],
    "a relation to another schema is named with it",
  );
  const upper = await singleRow(`?id=${VAULT.toUpperCase()}::wide_records`);
  assert.equal(upper.status, 404, "a case-insensitive lookup would find it");
  const unknown = await singleRow(`?id=${VAULT}::nothing`);
  assert.equal(unknown.status, 404, "an unknown id is refused 404");
  assert.equal((await singleRow("")).status, 400, "a missing id: 400");
  assert.equal((await singleRow("?id=")).status, 400, "an empty id: 400");
}

async function inference(): Promise<void> {
  const all = await schemas();
  const fieldsOf = (schemaId: string, table: string) =>
    at(tableOf(all, schemaId, table), "fields");
  const kinds = (fields: JsonValue) =>
    keysAt(fields).map((name) => `${name}:${textAt(fields, name, "kind")}`);
  const orders = fieldsOf(SHOP, "orders");
  const customers = fieldsOf(SHOP, "customers");
  assert.deepEqual(
    kinds(orders),
    [
      "_id:string",
      "number:string",
      "customer_id:string",
      "status:string",
      "created_at:date",
      "channel:string",
      "total:number",
      "currency:string",
      "coupon_id:union",
      "shipping:object",
    ],
    "declared columns come first, sampled ones after, in order",
  );
  assert.deepEqual(
    at(orders, "coupon_id", "members"),
    [{ kind: "string" }, { kind: "null" }],
    "a column holding null in some rows is a union of its type and null",
  );
  assert.deepEqual(
    kinds(customers),
    [
      "_id:string",
      "email:string",
      "company:string",
      "credit_limit:number",
      "vip:boolean",
    ],
    "columns no decorator names are typed by their rows",
  );
  assert.deepEqual(
    at(fieldsOf(SHOP, "products"), "tags"),
    { kind: "array", element: { kind: "string" } },
    "an array is typed by its elements",
  );
  assert.deepEqual(
    at(fieldsOf(DEMO, "posts"), "tag_ids"),
    { kind: "array" },
    "an array of no element stays untyped",
  );
  assert.deepEqual(
    keysAt(fieldsOf(SHOP, "order_items")),
    ["_id", "order_id", "product_id", "quantity", "unit_price"],
    "a table whose rows are all in named instances is sampled from them",
  );
  assert.ok(
    ![...keysAt(orders), ...keysAt(customers)].includes("_instance"),
    "the instance tag of the store is not a column",
  );
  assert.deepEqual(
    keysAt(fieldsOf(QUIRKS, "members")),
    ["_id", "constructor", "note"],
    "a lookup through Object.prototype would drop the constructor column",
  );
  const shop = schemaOf(all, SHOP);
  assert.deepEqual(at(shop, "instances"), ["eu", "us"], "its instances");
  assert.deepEqual(
    at(shop, "stats"),
    { tableCount: 4, elementCount: 6, instanceCount: 3 },
    "a schema reports its stats",
  );
  const hollow = schemaOf(all, HOLLOW);
  assert.notEqual(hollow, null, "a schema without a table is listed");
  assert.deepEqual(
    [itemsAt(hollow, "tables").length, at(hollow, "stats", "tableCount")],
    [0, 0],
    "with no table",
  );
}

async function ownerOnly(): Promise<void> {
  const paths = [
    "/database/schemas",
    "/database/tables/source",
    `/database/tables/source/row?id=${SHOP}::orders`,
    `/database/tables/instances?schema=${SHOP}`,
  ];
  for (const path of paths) {
    const anonymous = await call(null, "GET", path);
    const reader = await call(member, "GET", path);
    const allowed = await call(owner, "GET", path);
    assert.equal(anonymous.status, 401, `${path} refuses nobody 401`);
    assert.equal(reader.status, 403, `${path} refuses a member 403`);
    assert.equal(allowed.status, 200, `${path} answers the owner`);
  }
}

describe("[integration] schemas journeys", function () {
  this.timeout(30_000);

  before(async () => {
    owner = await createOwnerSession("schemas-journeys-owner@test.local");
    member = await createMemberSession("schemas-journeys-member@test.local");
    await seed();
  });
  after(async () => {
    await cleanUp();
    await owner.remove();
    await member.remove();
  });

  it(
    "the-source-counts-rows-columns-indexes-relations-and-modifiers-of-each-table",
    tableCounts,
  );
  it(
    "schema-instance-search-and-structure-filters-narrow-the-source-and-combine",
    sourceFilters,
  );
  it(
    "rows-are-counted-in-the-picked-instance-default-named-or-all",
    instanceCounts,
  );
  it(
    "the-instances-route-searches-sorts-and-limits-the-named-instances-of-a-schema",
    instanceSearch,
  );
  it("a-table-is-read-by-its-schema-and-name-id", singleTable);
  it("columns-are-declared-in-code-and-inferred-from-sampled-rows", inference);
  it("the-tables-and-schemas-routes-answer-the-platform-owner-only", ownerOnly);
});
