import { check } from "../../database.mjs";
import { byName, nodes, openDiagram, tables } from "./diagram-page.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */
/** @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef */

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} The names of the stub chips drawn
 */
async function chips(tab) {
  return (await nodes(tab)).filter((node) => node.kind === "stubNode").map((node) => node.lines.join(" "));
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The selection bar's text, empty when none shows
 */
async function selectionBar(tab) {
  return (await tab.page.locator(".diagram-float").filter({ hasText: /Inspect|Show all tables/ }).first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
}

/** @type {JourneyDef} */
export const stubs = {
  id: "a-relation-to-a-table-not-drawn-ends-on-a-dashed-chip-that-opens-that-table",
  title: "focusing a table leaves the others out and a relation to one of them ends on a dashed chip that opens it, and a relation to another schema ends on a chip that opens that schema's diagram on the table",
  entryPoint: "/modules/database/diagram?schema=shop and ?schema=links",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop");
    const before = await chips(tab);
    await tab.page.locator('.vue-flow__node[data-id="shop::orders"] .cursor-grab, .vue-flow__node[data-id="shop::orders"]').first().click({ position: { x: 90, y: 18 } });
    await tab.page.waitForTimeout(600);
    const bar = await selectionBar(tab);
    await tab.click({ role: "button", name: "Focus" });
    await tab.page.waitForTimeout(1200);
    const focused = await tables(tab);
    const focusChips = await chips(tab);
    const focusBar = await selectionBar(tab);
    await ctx.verify("focus on orders", [
      check("no chip while every target is drawn", before.length === 0, before),
      check("selecting a table offers Inspect and Focus", /^orders Inspect Focus$/.test(bar), bar),
      check("only orders and its neighbours stay", focused.map((node) => node.name).sort().join() === "customers,order_items,orders", focused.map((node) => node.name)),
      check("the table order_items points to, left out, is a chip", focusChips.join() === "shop.products", focusChips),
      check("the bar offers to show all tables", /Show all tables/.test(focusBar), focusBar),
    ]);
    await tab.page.getByRole("button", { name: "shop.products" }).click();
    await tab.page.waitForTimeout(1500);
    const afterChip = await tables(tab);
    const nowChips = await chips(tab);
    await ctx.verify("the chip opens the table", [
      check("the focus is lifted and all four tables are drawn", afterChip.map((node) => node.name).sort().join() === "customers,order_items,orders,products" && nowChips.length === 0, afterChip.map((node) => node.name)),
      check("products is the selected table", byName(afterChip, "products")?.selected === true && (await selectionBar(tab)).startsWith("products"), await selectionBar(tab)),
    ]);

    const links = await openDiagram(ctx, "?schema=links", tab);
    const cross = await chips(links);
    await ctx.verify("a relation to another schema", [check("customer_refs ends on a chip naming shop.customers", cross.join() === "shop.customers", cross)]);
    await links.page.getByRole("button", { name: "shop.customers" }).click();
    await links.page.waitForTimeout(2500);
    const url = new URL(links.page.url());
    const shop = await tables(links);
    await ctx.verify("the chip opens the other schema's diagram on that table", [
      check("the URL names shop and customers", url.searchParams.get("schema") === "shop" && url.searchParams.get("table") === "customers", links.page.url()),
      check("the shop tables are drawn with customers selected", shop.map((node) => node.name).sort().join() === "customers,order_items,orders,products" && byName(shop, "customers")?.selected === true, shop.map((node) => node.name)),
    ]);
  },
};

/** @type {JourneyDef} */
export const deepLinks = {
  id: "the-url-picks-the-schema-and-the-table-and-names-what-it-cannot-find",
  title: "?schema=&table= opens that schema with that table selected, an unknown schema or table is reported by a message and dropped from the URL, and the schema picker steps the browser history",
  entryPoint: "/modules/database/diagram?schema=&table=",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop&table=orders");
    const picked = await tables(tab);
    await ctx.verify("a table in the URL", [
      check("shop is drawn with orders selected", picked.length === 4 && byName(picked, "orders")?.selected === true && (await selectionBar(tab)).startsWith("orders"), await selectionBar(tab)),
      check("the schema picker shows shop", (await tab.page.getByRole("combobox", { name: "Schema" }).innerText()).trim() === "shop", "picker"),
    ]);

    const noTable = await openDiagram(ctx, "?schema=shop&table=nothing", tab);
    await noTable.page.waitForTimeout(800);
    const missing = await noTable.shows(/Table nothing not found in shop/);
    await ctx.verify("a table that does not exist", [
      missing,
      check("it leaves the URL and shop stays drawn", !new URL(noTable.page.url()).searchParams.has("table") && (await tables(noTable)).length === 4, noTable.page.url()),
    ]);

    const noSchema = await openDiagram(ctx, "?schema=nowhere", tab);
    const gone = await noSchema.shows(/Schema nowhere not found/);
    await ctx.verify("a schema that does not exist", [
      gone,
      check("it leaves the URL and the first schema is drawn", !new URL(noSchema.page.url()).searchParams.has("schema") && (await tables(noSchema)).length > 0, noSchema.page.url()),
    ]);

    const start = await openDiagram(ctx, "?schema=shop", tab);
    await start.click({ role: "combobox", name: "Schema" });
    await start.page.getByRole("option", { name: "vault", exact: true }).click();
    await start.page.waitForTimeout(1500);
    const vault = await tables(start);
    const afterPick = new URL(start.page.url()).searchParams.get("schema");
    await start.page.goBack();
    await start.page.waitForTimeout(1500);
    const back = await tables(start);
    await ctx.verify("the schema picker", [
      check("picking vault draws its five tables and puts it in the URL", afterPick === "vault" && vault.map((node) => node.name).sort().join() === "accounts,parents_links,parents_registry,plain_notes,wide_records", [afterPick, vault.map((node) => node.name)]),
      check("Back returns to the shop diagram", new URL(start.page.url()).searchParams.get("schema") === "shop" && back.length === 4, start.page.url()),
    ]);
  },
};

/** @type {JourneyDef} */
export const emptySchema = {
  id: "a-schema-without-a-table-says-so-and-offers-no-note-or-auto-layout",
  title: "a registered schema that declares no table shows No tables in it with its description, and its Note and Auto layout controls are disabled while N adds nothing",
  entryPoint: "/modules/database/diagram?schema=hollow",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=hollow");
    await tab.page.keyboard.press("n");
    await tab.page.waitForTimeout(800);
    await ctx.verify("the hollow schema", [
      tab.shows(/No tables in hollow/),
      tab.shows(/This schema is registered but declares no table yet\./),
      tab.enabled({ role: "button", name: "Note" }, { disabled: true }),
      tab.enabled({ role: "button", name: "Auto layout" }, { disabled: true }),
      check("no table is drawn and N added no note", (await nodes(tab)).length === 0, (await nodes(tab)).length),
    ]);
  },
};
