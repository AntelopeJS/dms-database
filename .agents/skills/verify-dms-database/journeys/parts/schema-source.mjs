import { check, db, isRow, list, member, pick, text } from "../../database.mjs";
import { ids, rowOf, schemas, source, tableOf } from "./schema-api.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef */

/**
 * @param {import("../../database.mjs").Row | undefined} row A source row
 * @param {{ rows: number, columns: number, indexes: number, relations: string[], modifiers: string[] }} expected What the row holds
 * @returns {boolean} Whether it holds exactly that
 */
function rowIs(row, expected) {
  return (
    pick(row, "elementCount") === expected.rows &&
    pick(row, "columnCount") === expected.columns &&
    pick(row, "indexCount") === expected.indexes &&
    JSON.stringify(pick(row, "relations")) === JSON.stringify(expected.relations) &&
    JSON.stringify(pick(row, "modifiers")) === JSON.stringify(expected.modifiers)
  );
}

/** @type {JourneyDef} */
export const tableCounts = {
  id: "the-source-counts-rows-columns-indexes-relations-and-modifiers-of-each-table",
  title: "each table of the source holds its rows in the default instance, its column, index and relation counts, the tables it points to (schema.table outside its schema) and its modifier names",
  entryPoint: "GET /api/database/tables/source",
  async run(ctx) {
    const listing = await source(ctx, "list every table");
    const reference = await schemas(ctx, "read the schemas the source is made of");
    const registered = reference.reduce((sum, schema) => sum + list(schema, "tables").length, 0);
    const expectations = {
      "shop::customers": { rows: 0, columns: 5, indexes: 1, relations: [], modifiers: [] },
      "shop::products": { rows: 6, columns: 4, indexes: 1, relations: [], modifiers: [] },
      "shop::orders": { rows: 0, columns: 10, indexes: 3, relations: ["customers"], modifiers: [] },
      "shop::order_items": { rows: 0, columns: 5, indexes: 1, relations: ["orders", "products"], modifiers: [] },
      "vault::accounts": { rows: 0, columns: 5, indexes: 1, relations: [], modifiers: ["Hashed", "Encrypted", "Localized"] },
      "vault::wide_records": { rows: 1, columns: 17, indexes: 0, relations: ["parents_registry"], modifiers: [] },
      "links::customer_refs": { rows: 0, columns: 2, indexes: 0, relations: ["shop.customers"], modifiers: [] },
      "demo::posts": { rows: 3, columns: 5, indexes: 2, relations: ["tags"], modifiers: [] },
      "metrics::readings": { rows: 1250, columns: 4, indexes: 1, relations: [], modifiers: [] },
      "metrics::empty_log": { rows: 0, columns: 2, indexes: 0, relations: [], modifiers: [] },
    };
    await ctx.verify("the listing counts", [
      check("the call answers 200", listing.status === 200, listing.status),
      check("total is the number of rows listed", listing.total === listing.rows.length, [listing.total, listing.rows.length]),
      check("all is the number of tables the schemas register", listing.all === registered && registered === listing.rows.length, [listing.all, registered, listing.rows.length]),
      check("every id is schema::table and unique", new Set(ids(listing.rows)).size === listing.rows.length && ids(listing.rows).every((id) => id === `${id.split("::")[0]}::${id.split("::")[1]}` && id.split("::").length === 2), ids(listing.rows).slice(0, 5)),
      ...Object.entries(expectations).map(([id, expected]) => check(`${id} holds ${JSON.stringify(expected)}`, rowIs(rowOf(listing.rows, id), expected), rowOf(listing.rows, id))),
      check("every row names its schema and table", listing.rows.every((row) => text(row, "id") === `${text(row, "schema")}::${text(row, "name")}`), listing.rows.length),
    ]);
  },
};

/** @type {JourneyDef} */
export const filters = {
  id: "schema-instance-search-and-structure-filters-narrow-the-source-and-combine",
  title: "the schema, the name or column search (any case, trimmed), the relations, modifiers and empty flags narrow the tables, combine all together, ignore unknown flags, and leave the all count alone",
  entryPoint: "GET /api/database/tables/source?filter_scope=&filter_q=&filter_has=",
  async run(ctx) {
    const everything = await source(ctx, "unfiltered");
    const shop = await source(ctx, "scope shop", { scope: "shop" });
    const none = await source(ctx, "scope that does not exist", { scope: "nope" });
    const byName = await source(ctx, "search ORDER in shop", { scope: "shop", q: "ORDER" });
    const trimmed = await source(ctx, "search ' order ' in shop", { scope: "shop", q: "  order  " });
    const byColumn = await source(ctx, "search email in shop", { scope: "shop", q: "email" });
    const either = await source(ctx, "search customer in shop", { scope: "shop", q: "customer" });
    const exactColumn = await source(ctx, "search customer_id in shop", { scope: "shop", q: "customer_id" });
    const tail = await source(ctx, "search tail_marker everywhere", { q: "tail_marker" });
    const related = await source(ctx, "relations in shop", { scope: "shop", has: "relations" });
    const modified = await source(ctx, "modifiers in vault", { scope: "vault", has: "modifiers" });
    const both = await source(ctx, "relations and modifiers in vault", { scope: "vault", has: "relations,modifiers" });
    const spaced = await source(ctx, "relations with an unknown flag", { scope: "shop", has: "relations, bogus" });
    const bogus = await source(ctx, "only an unknown flag", { scope: "shop", has: "bogus" });
    const empty = await source(ctx, "empty in shop, default instance", { scope: "shop", has: "empty" });
    const combined = await source(ctx, "search, relations and empty in shop", { scope: "shop", q: "order", has: "relations,empty" });
    const nonEmptyPlusModifiers = await source(ctx, "empty and modifiers in vault", { scope: "vault", has: "modifiers,empty" });
    const sorted = (/** @type {{ rows: import("../../database.mjs").Row[] }} */ listing) => ids(listing.rows).sort();
    await ctx.verify("the filters", [
      check("unfiltered lists every table", everything.total === everything.all && everything.rows.length === everything.all, [everything.total, everything.all]),
      check("a schema lists its own tables only", JSON.stringify(sorted(shop)) === JSON.stringify(["shop::customers", "shop::order_items", "shop::orders", "shop::products"]), sorted(shop)),
      check("the schema filter leaves all as the registered count", shop.all === everything.all && shop.total === 4, [shop.total, shop.all]),
      check("an unknown schema lists nothing", none.total === 0 && none.rows.length === 0 && none.all === everything.all, [none.total, none.all]),
      check("a name matches in any case", JSON.stringify(sorted(byName)) === JSON.stringify(["shop::order_items", "shop::orders"]), sorted(byName)),
      check("a search is trimmed", JSON.stringify(sorted(trimmed)) === JSON.stringify(sorted(byName)), sorted(trimmed)),
      check("a column name finds its table", JSON.stringify(sorted(byColumn)) === JSON.stringify(["shop::customers"]), sorted(byColumn)),
      check("a search names the table or a column", JSON.stringify(sorted(either)) === JSON.stringify(["shop::customers", "shop::orders"]), sorted(either)),
      check("a column name is not a table name", JSON.stringify(sorted(exactColumn)) === JSON.stringify(["shop::orders"]), sorted(exactColumn)),
      check("a column found beyond the first twelve still finds the table", JSON.stringify(sorted(tail)) === JSON.stringify(["vault::wide_records"]), sorted(tail)),
      check("relations keeps the tables that point to another table", JSON.stringify(sorted(related)) === JSON.stringify(["shop::order_items", "shop::orders"]), sorted(related)),
      check("modifiers keeps the tables with hashed, localized or encrypted columns", JSON.stringify(sorted(modified)) === JSON.stringify(["vault::accounts"]), sorted(modified)),
      check("both structure flags must hold", both.total === 0, sorted(both)),
      check("an unknown flag is ignored among known ones", JSON.stringify(sorted(spaced)) === JSON.stringify(sorted(related)), sorted(spaced)),
      check("only an unknown flag filters nothing", bogus.total === 4, sorted(bogus)),
      check("empty keeps the tables without a row in the default instance", JSON.stringify(sorted(empty)) === JSON.stringify(["shop::customers", "shop::order_items", "shop::orders"]), sorted(empty)),
      check("search, relations and empty combine", JSON.stringify(sorted(combined)) === JSON.stringify(["shop::order_items", "shop::orders"]), sorted(combined)),
      check("modifiers and empty combine", JSON.stringify(sorted(nonEmptyPlusModifiers)) === JSON.stringify(["vault::accounts"]), sorted(nonEmptyPlusModifiers)),
    ]);
  },
};

/** @type {JourneyDef} */
export const instanceCounts = {
  id: "rows-are-counted-in-the-picked-instance-default-named-or-all",
  title: "rows count in the default instance unless an instance is picked: a region counts its own rows, all counts every instance at once, and empty means no row in the picked instance",
  entryPoint: "GET /api/database/tables/source?filter_instance=",
  async run(ctx) {
    const counts = async (/** @type {string | undefined} */ instance) => {
      const listing = await source(ctx, `shop rows in ${instance ?? "the default instance"}`, { scope: "shop", instance });
      return Object.fromEntries(listing.rows.map((row) => [text(row, "name"), pick(row, "elementCount")]));
    };
    const byDefault = await counts(undefined);
    const named = await counts("default");
    const eu = await counts("eu");
    const us = await counts("us");
    const all = await counts("all");
    const missing = await counts("atlantis");
    const emptyInEu = await source(ctx, "empty in eu", { scope: "shop", instance: "eu", has: "empty" });
    const emptyInAll = await source(ctx, "empty in all", { scope: "shop", instance: "all", has: "empty" });
    const metricsInEu = await source(ctx, "empty metrics in eu", { scope: "metrics", instance: "eu", has: "empty" });
    const row = await db(ctx, "read orders by id", "GET", "/tables/source/row?id=shop::orders");
    await ctx.verify("rows per instance", [
      check("no instance counts the default one", JSON.stringify(byDefault) === JSON.stringify({ customers: 0, products: 6, orders: 0, order_items: 0 }), byDefault),
      check("an instance named default is the default one", JSON.stringify(named) === JSON.stringify(byDefault), named),
      check("eu counts its own rows", JSON.stringify(eu) === JSON.stringify({ customers: 24, products: 6, orders: 80, order_items: 160 }), eu),
      check("us counts its own rows", JSON.stringify(us) === JSON.stringify({ customers: 24, products: 6, orders: 80, order_items: 160 }), us),
      check("all counts every instance at once", all.customers === 48 && all.orders === 160 && all.order_items === 320 && all.products === 18, all),
      check("an instance that does not exist counts nothing", Object.values(missing).every((count) => count === 0), missing),
      check("empty is judged in the picked instance", emptyInEu.total === 0 && emptyInAll.total === 0, [emptyInEu.total, emptyInAll.total]),
      check("empty in eu keeps both metrics tables", JSON.stringify(ids(metricsInEu.rows).sort()) === JSON.stringify(["metrics::empty_log", "metrics::readings"]), ids(metricsInEu.rows)),
      check("a single row is counted in the default instance", pick(row.body, "elementCount") === 0 && pick(row.body, "id") === "shop::orders" && pick(row.body, "columnCount") === 10, row.body),
    ]);
  },
};

/** @type {JourneyDef} */
export const instanceSearch = {
  id: "the-instances-route-searches-sorts-and-limits-the-named-instances-of-a-schema",
  title: "a schema's named instances come sorted with numbers by value, are searched by part of the name in any case, cut at the limit (clamped between 1 and 500) with how many matched, and refuse a missing or unknown schema",
  entryPoint: "GET /api/database/tables/instances",
  async run(ctx) {
    const get = (/** @type {string} */ label, /** @type {string} */ query) => db(ctx, label, "GET", `/tables/instances?${query}`);
    const shop = await get("instances of shop", "schema=shop");
    const searchedEu = await get("search E", "schema=shop&search=E");
    const searchedUs = await get("search U", "schema=shop&search=U");
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
      check("tables of named instances are sampled from the first instance holding rows", Object.keys(fieldsOf("shop", "order_items") ?? {}).join() === "_id,order_id,product_id,quantity,unit_price", fieldsOf("shop", "order_items")),
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
