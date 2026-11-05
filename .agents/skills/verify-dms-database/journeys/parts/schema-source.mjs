import { check, db, list, pick, text } from "../../database.mjs";
import { ids, rowOf, schemas, source } from "./schema-api.mjs";

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
      "vault::accounts": { rows: 2, columns: 5, indexes: 1, relations: [], modifiers: ["Hashed", "Encrypted", "Localized"] },
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
      check("modifiers and empty combine: vault.accounts holds two rows, so no table is both", JSON.stringify(sorted(nonEmptyPlusModifiers)) === "[]", sorted(nonEmptyPlusModifiers)),
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
