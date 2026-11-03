import { check } from "../../database.mjs";
import { listUntil, listed, openSchemas } from "./schema-page.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */
/** @typedef {import("./schema-page.mjs").Listed} Listed */
/** @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef */

const GRID = { role: "table", name: "Tables" };

/**
 * @param {Tab} tab The tab
 * @param {RegExp} header The header's name
 * @returns {Promise<void>}
 */
async function sortBy(tab, header) {
  await tab.click({ role: "button", name: header, within: GRID });
}

/**
 * @param {Listed[]} rows The listed rows
 * @param {keyof Listed} column The column
 * @returns {string} The column's values, joined
 */
const values = (rows, column) => rows.map((row) => String(row[column])).join();

/**
 * @param {string} expected The values awaited
 * @param {keyof Listed} column The column
 * @returns {(rows: Listed[]) => boolean} Whether the list holds them
 */
const reads = (expected, column) => (rows) => values(rows, column) === expected;

/** @type {JourneyDef} */
export const sorting = {
  id: "each-of-the-five-sortable-columns-sorts-both-ways-and-the-third-click-restores-the-default-order",
  title: "Table, Schema, Rows, Columns and Indexes sort ascending, then descending, then back to the default order of most rows first; Relations and Modifiers do not sort",
  entryPoint: "/modules/database/schemas column headers",
  async run(ctx) {
    const byName = await openSchemas(ctx, "?scope=shop&instance=eu");
    const initial = await listUntil(byName, reads("order_items,orders,customers,products", "name"));
    await ctx.verify("the default order", [check("most rows first", values(initial, "name") === "order_items,orders,customers,products" && values(initial, "rows") === "160,80,24,6", values(initial, "rows"))]);

    await sortBy(byName, /^Table$/);
    const nameAsc = await listUntil(byName, reads("customers,order_items,orders,products", "name"));
    await sortBy(byName, /^Table$/);
    const nameDesc = await listUntil(byName, reads("products,orders,order_items,customers", "name"));
    await sortBy(byName, /^Table$/);
    const nameDefault = await listUntil(byName, reads("order_items,orders,customers,products", "name"));
    await ctx.verify("Table", [
      check("ascending by name", values(nameAsc, "name") === "customers,order_items,orders,products", values(nameAsc, "name")),
      check("descending by name", values(nameDesc, "name") === "products,orders,order_items,customers", values(nameDesc, "name")),
      check("the third click is the default order", values(nameDefault, "name") === "order_items,orders,customers,products", values(nameDefault, "name")),
    ]);

    await sortBy(byName, /^Columns$/);
    await listUntil(byName, reads("products,customers,order_items,orders", "name"));
    await sortBy(byName, /^Rows/);
    const rowsAsc = await listUntil(byName, reads("6,24,80,160", "rows"));
    await sortBy(byName, /^Rows/);
    const rowsDesc = await listUntil(byName, reads("160,80,24,6", "rows"));
    await ctx.verify("Rows", [
      check("ascending by rows", values(rowsAsc, "rows") === "6,24,80,160" && values(rowsAsc, "name") === "products,customers,orders,order_items", values(rowsAsc, "name")),
      check("descending by rows", values(rowsDesc, "rows") === "160,80,24,6" && values(rowsDesc, "name") === "order_items,orders,customers,products", values(rowsDesc, "name")),
    ]);

    const vault = await openSchemas(ctx, "?scope=vault");
    await listUntil(vault, (rows) => rows.length === 5);
    await sortBy(vault, /^Columns$/);
    const columnsAsc = await listUntil(vault, (rows) => values(rows, "columns") === "2,2,2,5,17");
    await sortBy(vault, /^Columns$/);
    const columnsDesc = await listUntil(vault, (rows) => values(rows, "columns") === "17,5,2,2,2");
    await sortBy(vault, /^Columns$/);
    await sortBy(vault, /^Indexes$/);
    const indexesAsc = await listUntil(vault, (rows) => values(rows, "indexes") === "0,0,0,0,1");
    await sortBy(vault, /^Indexes$/);
    const indexesDesc = await listUntil(vault, (rows) => values(rows, "indexes") === "1,0,0,0,0");
    await ctx.verify("Columns and Indexes", [
      check("columns ascending", values(columnsAsc, "columns") === "2,2,2,5,17" && columnsAsc.at(-1)?.name === "wide_records" && columnsAsc.at(-2)?.name === "accounts", values(columnsAsc, "name")),
      check("columns descending", values(columnsDesc, "columns") === "17,5,2,2,2" && columnsDesc[0]?.name === "wide_records", values(columnsDesc, "name")),
      check("indexes ascending", values(indexesAsc, "indexes") === "0,0,0,0,1" && indexesAsc.at(-1)?.name === "accounts", values(indexesAsc, "name")),
      check("indexes descending", values(indexesDesc, "indexes") === "1,0,0,0,0" && indexesDesc[0]?.name === "accounts", values(indexesDesc, "name")),
      check("Relations is not a sort button", (await vault.page.getByRole("table", { name: "Tables" }).getByRole("button", { name: "Relations", exact: true }).count()) === 0, "Relations"),
      check("Modifiers is not a sort button", (await vault.page.getByRole("table", { name: "Tables" }).getByRole("button", { name: "Modifiers", exact: true }).count()) === 0, "Modifiers"),
    ]);

    const labels = await openSchemas(ctx, "?q=entries");
    await listUntil(labels, (rows) => rows.length === 8);
    await sortBy(labels, /^Schema$/);
    const schemaAsc = await listUntil(labels, reads("app-site,billing,core,global,production,reviews,staging-eu,tenant-acme", "schema"));
    await sortBy(labels, /^Schema$/);
    const schemaDesc = await listUntil(labels, reads("tenant-acme,staging-eu,reviews,production,global,core,billing,app-site", "schema"));
    await ctx.verify("Schema", [
      check("ascending by schema", values(schemaAsc, "schema") === "app-site,billing,core,global,production,reviews,staging-eu,tenant-acme", values(schemaAsc, "schema")),
      check("descending by schema", values(schemaDesc, "schema") === "tenant-acme,staging-eu,reviews,production,global,core,billing,app-site", values(schemaDesc, "schema")),
    ]);
  },
};

/** @type {JourneyDef} */
export const columnsOfTags = {
  id: "the-relations-and-modifiers-columns-name-the-tables-and-the-flags",
  title: "the Relations column names the tables each table points to (schema.table outside its schema) and the Modifiers column flags Hashed, Encrypted and Localized columns, and the table heading counts the tables listed",
  entryPoint: "/modules/database/schemas",
  async run(ctx) {
    const shop = await openSchemas(ctx, "?scope=shop");
    const shopRows = await listUntil(shop, (rows) => rows.length === 4);
    const byName = Object.fromEntries(shopRows.map((row) => [row.name, row]));
    const heading = await shop.page.getByRole("heading", { level: 2 }).first().innerText();
    await ctx.verify("shop", [
      check("order_items points to orders and products", byName.order_items?.relations.join() === "orders,products", byName.order_items),
      check("orders points to customers", byName.orders?.relations.join() === "customers", byName.orders),
      check("customers and products point nowhere", byName.customers?.relations.length === 0 && byName.products?.relations.length === 0, [byName.customers, byName.products]),
      check("no shop table has a modifier", shopRows.every((row) => row.modifiers.length === 0), shopRows.map((row) => row.modifiers)),
      check("the heading counts the tables listed", /Tables\s*4/.test(heading.replace(/\s+/g, " ")), heading),
    ]);
    const links = await openSchemas(ctx, "?scope=links");
    const linkRows = await listUntil(links, (rows) => rows.length > 0);
    await ctx.verify("a relation to another schema", [check("customer_refs names shop.customers", linkRows.find((row) => row.name === "customer_refs")?.relations.join() === "shop.customers", linkRows.find((row) => row.name === "customer_refs"))]);
    const vault = await openSchemas(ctx, "?scope=vault");
    const vaultRows = await listUntil(vault, (rows) => rows.length === 5);
    await ctx.verify("modifiers", [
      check("accounts flags hashed, encrypted and localized columns", vaultRows.find((row) => row.name === "accounts")?.modifiers.join() === "Hashed,Encrypted,Localized", vaultRows.find((row) => row.name === "accounts")),
      check("the other vault tables have none", vaultRows.filter((row) => row.name !== "accounts").every((row) => row.modifiers.length === 0), vaultRows.map((row) => row.modifiers)),
      check("every listed table is what the API counted", (await listed(vault)).length === 5, 5),
    ]);
  },
};
