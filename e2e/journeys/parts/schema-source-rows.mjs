import { check, db, isRow, list, member, pick, text } from "../../database.mjs";
import { schemas, tableOf } from "./schema-api.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef */

/** @type {JourneyDef} */
export const instanceSearch = {
  id: "the-instances-route-searches-sorts-and-limits-the-named-instances-of-a-schema",
  title: "a schema's named instances come sorted with numbers by value, are searched by part of the name in any case, cut at the limit (clamped between 1 and 500) with how many matched, and refuse a missing or unknown schema",
  entryPoint: "GET /api/database/tables/instances",
  async run(ctx) {
    const get = (/** @type {string} */ label, /** @type {string} */ query) => db(ctx, label, "GET", `/tables/instances?${query}`);
    const shop = await get("instances of shop", "schema=shop");
    const searchedEu = await get("search E", "schema=shop&search=E");
    const searchedUs = await get("search S", "schema=shop&search=S");
    const noMatch = await get("search zzz", "schema=shop&search=zzz");
    const tenants = await get("instances of links", "schema=links");
    const limited = await get("limit 2", "schema=links&limit=2");
    const floor = await get("limit 0", "schema=links&limit=0");
    const garbage = await get("limit abc", "schema=links&limit=abc");
    const ceiling = await get("limit 9999", "schema=links&limit=9999");
    const plain = await get("instances of metrics", "schema=metrics");
    const unknown = await get("unknown schema", "schema=nope");
    const absent = await get("no schema", "");
    await ctx.verify("the named instances", [
      check("shop has eu and us", JSON.stringify(pick(shop.body, "instances")) === '["eu","us"]' && pick(shop.body, "total") === 2, shop.body),
      check("a search matches part of a name in any case", JSON.stringify(pick(searchedEu.body, "instances")) === '["eu"]' && JSON.stringify(pick(searchedUs.body, "instances")) === '["us"]', [searchedEu.body, searchedUs.body]),
      check("a search with no match is empty", JSON.stringify(pick(noMatch.body, "instances")) === "[]" && pick(noMatch.body, "total") === 0, noMatch.body),
      check("numbers sort by value", JSON.stringify(pick(tenants.body, "instances")) === '["tenant-1","tenant-2","tenant-10"]', tenants.body),
      check("the limit cuts the list and total says how many matched", JSON.stringify(pick(limited.body, "instances")) === '["tenant-1","tenant-2"]' && pick(limited.body, "total") === 3, limited.body),
      check("a limit under 1 is read as 1", JSON.stringify(pick(floor.body, "instances")) === '["tenant-1"]' && pick(floor.body, "total") === 3, floor.body),
      check("an unreadable limit falls back to the default of 100", pick(garbage.body, "total") === 3 && list(garbage.body, "instances").length === 0 && Array.isArray(pick(garbage.body, "instances")) && String(pick(garbage.body, "instances")) === "tenant-1,tenant-2,tenant-10", garbage.body),
      check("a large limit is clamped, not refused", ceiling.status === 200 && pick(ceiling.body, "total") === 3, ceiling.body),
      check("a schema without named instances lists none", JSON.stringify(pick(plain.body, "instances")) === "[]" && pick(plain.body, "total") === 0, plain.body),
      check("an unknown schema is refused 404", unknown.status === 404, unknown),
      check("a missing schema is refused 400", absent.status === 400, absent),
    ]);
  },
};

/** @type {JourneyDef} */
export const singleRow = {
  id: "a-table-is-read-by-its-schema-and-name-id",
  title: "the row of a table is read by its schema::name id with its rows counted in the default instance, an unknown id is refused 404 and a missing one 400",
  entryPoint: "GET /api/database/tables/source/row",
  async run(ctx) {
    const found = await db(ctx, "read vault::wide_records", "GET", "/tables/source/row?id=vault::wide_records");
    const related = await db(ctx, "read links::customer_refs", "GET", "/tables/source/row?id=links::customer_refs");
    const wrongCase = await db(ctx, "read VAULT::wide_records", "GET", "/tables/source/row?id=VAULT::wide_records");
    const unknown = await db(ctx, "read an unknown id", "GET", "/tables/source/row?id=vault::nothing");
    const missing = await db(ctx, "read without an id", "GET", "/tables/source/row");
    const blank = await db(ctx, "read an empty id", "GET", "/tables/source/row?id=");
    await ctx.verify("single table rows", [
      check("the row holds the table's figures", pick(found.body, "schema") === "vault" && pick(found.body, "name") === "wide_records" && pick(found.body, "elementCount") === 1 && pick(found.body, "columnCount") === 17 && pick(found.body, "indexCount") === 0, found.body),
      check("its relation is named without the schema when it is the same", JSON.stringify(pick(found.body, "relations")) === '["parents_registry"]', found.body),
      check("a relation to another schema is named with it", JSON.stringify(pick(related.body, "relations")) === '["shop.customers"]', related.body),
      check("ids are case-sensitive", wrongCase.status === 404, wrongCase.status),
      check("an unknown id is refused 404", unknown.status === 404, unknown),
      check("a missing id is refused 400", missing.status === 400, missing),
      check("an empty id is refused 400", blank.status === 400, blank),
    ]);
  },
};

/** @type {JourneyDef} */
export const inference = {
  id: "columns-are-declared-in-code-and-inferred-from-sampled-rows",
  title: "a table lists its declared columns first (key, indexed, relation fields), then the other columns sampled from its rows with their types, null shown as a union, objects and arrays typed, the instance tag left out, and a column named like an object member kept",
  entryPoint: "GET /api/database/schemas",
  async run(ctx) {
    const all = await schemas(ctx, "read the schemas");
    const fieldsOf = (/** @type {string} */ schema, /** @type {string} */ table) => pick(tableOf(all, schema, table), "fields");
    const kinds = (/** @type {unknown} */ fields) => (isRow(fields) ? Object.entries(fields).map(([name, descriptor]) => `${name}:${text(descriptor, "kind")}`) : []);
    const orders = fieldsOf("shop", "orders");
    const members = fieldsOf("quirks", "members");
    const shop = all.find((schema) => text(schema, "id") === "shop");
    const hollow = all.find((schema) => text(schema, "id") === "hollow");
    await ctx.verify("column inference", [
      check("declared columns come first, sampled ones after, in order", JSON.stringify(kinds(orders)) === JSON.stringify(["_id:string", "number:string", "customer_id:string", "status:string", "created_at:date", "channel:string", "total:number", "currency:string", "coupon_id:union", "shipping:object"]), kinds(orders)),
      check("a column holding null in some rows is a union of its type and null", JSON.stringify(pick(orders, "coupon_id", "members")) === JSON.stringify([{ kind: "string" }, { kind: "null" }]), pick(orders, "coupon_id")),
      check("columns no decorator names are typed by their rows", JSON.stringify(kinds(fieldsOf("shop", "customers"))) === JSON.stringify(["_id:string", "email:string", "company:string", "credit_limit:number", "vip:boolean"]), kinds(fieldsOf("shop", "customers"))),
      check("an array is typed by its elements", JSON.stringify(pick(fieldsOf("shop", "products"), "tags")) === JSON.stringify({ kind: "array", element: { kind: "string" } }), pick(fieldsOf("shop", "products"), "tags")),
      check("an array of no element stays untyped", JSON.stringify(pick(fieldsOf("demo", "posts"), "tag_ids")) === JSON.stringify({ kind: "array" }), pick(fieldsOf("demo", "posts"), "tag_ids")),
      check("the columns of a table whose rows are all in named instances are sampled from them", Object.keys(fieldsOf("shop", "order_items") ?? {}).join() === "_id,order_id,product_id,quantity,unit_price", fieldsOf("shop", "order_items")),
      check("the instance tag of the store is not a column", ![...Object.keys(orders ?? {}), ...Object.keys(fieldsOf("shop", "customers") ?? {})].includes("_instance"), Object.keys(orders ?? {})),
      check("a column named constructor is a column of its own", JSON.stringify(Object.keys(members ?? {})) === JSON.stringify(["_id", "constructor", "note"]), Object.keys(members ?? {})),
      check("a schema reports its instances and stats", JSON.stringify(pick(shop, "instances")) === '["eu","us"]' && JSON.stringify(pick(shop, "stats")) === JSON.stringify({ tableCount: 4, elementCount: 6, instanceCount: 3 }), pick(shop, "stats")),
      check("a schema without a table is listed with none", hollow !== undefined && list(hollow, "tables").length === 0 && pick(hollow, "stats", "tableCount") === 0, hollow),
    ]);
  },
};

/** @type {JourneyDef} */
export const ownerOnly = {
  id: "the-tables-and-schemas-routes-answer-the-platform-owner-only",
  title: "the schemas and tables routes refuse a request without a session 401 and a member who is not the platform owner 403",
  entryPoint: "GET /api/database/schemas, /tables/source, /tables/source/row, /tables/instances",
  async run(ctx) {
    await member(ctx, "reader", []);
    const paths = ["/schemas", "/tables/source", "/tables/source/row?id=shop::orders", "/tables/instances?schema=shop"];
    const checks = [];
    for (const path of paths) {
      const anon = await db(ctx, `${path} without a session`, "GET", path, { as: "anon" });
      const reader = await db(ctx, `${path} as a member`, "GET", path, { as: "reader" });
      const owner = await db(ctx, `${path} as the owner`, "GET", path);
      checks.push(check(`${path} refuses nobody 401`, anon.status === 401, anon.status), check(`${path} refuses a member 403`, reader.status === 403, reader.status), check(`${path} answers the owner`, owner.status === 200, owner.status));
    }
    await ctx.verify("who may read", checks);
  },
};
