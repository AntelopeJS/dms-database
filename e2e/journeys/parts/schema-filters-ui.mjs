import { check, db, pick } from "../../database.mjs";
import { BAR, countText, listUntil, listed, openSchemas, paramsUntil, params, pickFrom, settled } from "./schema-page.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */
/** @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef */

const SEARCH = { role: "textbox", name: "Find a table or column" };

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<number>} How many tables are registered
 */
async function registered(ctx) {
  const answer = await db(ctx, "count the registered tables", "GET", "/tables/source");
  return Number(pick(answer.body, "all"));
}

/**
 * @param {Tab} tab The tab
 * @param {string} chip A chip's label
 * @returns {Promise<string | null>} Its aria-pressed
 */
function pressed(tab, chip) {
  return tab.page.getByRole("button", { name: chip, exact: true }).getAttribute("aria-pressed");
}

/**
 * @param {Tab} tab The tab
 * @param {string} menu The menu's label
 * @returns {Promise<string>} What the menu shows as picked
 */
async function picked(tab, menu) {
  return (await tab.page.locator("[data-dms-database-schemas-filter-bar]").getByRole("button", { name: menu }).first().innerText()).trim();
}

/** @param {Listed[]} rows @returns {string} */
const names = (rows) => rows.map((row) => row.name).sort().join();
/** @typedef {import("./schema-page.mjs").Listed} Listed */

/** @type {JourneyDef} */
export const eachFilter = {
  id: "each-filter-of-the-bar-narrows-the-list-and-sets-its-own-url-key",
  title: "the Schema and Instance menus, the name or column search and the relations, modifiers and empty chips each narrow the list, set their key in the URL, and the bar counts N of M tables only while filtered",
  entryPoint: "/modules/database/schemas filter bar",
  async run(ctx) {
    const all = await registered(ctx);
    const tab = await openSchemas(ctx);
    const bare = await listed(tab);
    const bareCount = await countText(tab);
    await ctx.verify("the bare page", [
      check("it lists tables of several schemas", new Set(bare.map((row) => row.schema)).size > 5, bare.length),
      check("the bar shows no count while nothing filters", bareCount === "", bareCount),
      check("no filter key is in the URL", ["scope", "instance", "q", "has"].every((key) => !params(tab).has(key)), tab.page.url()),
    ]);

    await pickFrom(tab, "Schema", "shop");
    const scoped = await paramsUntil(tab, (query) => query.get("scope") === "shop");
    const shop = await listUntil(tab, (rows) => rows.length === 4 && rows.every((row) => row.schema === "shop"));
    const shopCount = await countText(tab);
    await ctx.verify("the Schema menu", [
      check("scope=shop is in the URL", scoped.get("scope") === "shop", tab.page.url()),
      check("the list holds the four tables of shop", names(shop) === "customers,order_items,orders,products", names(shop)),
      check("the bar counts the shown and the registered tables", shopCount === `4 of ${all} tables`, shopCount),
      check("the menu shows the schema", (await picked(tab, "Schema")).includes("shop"), await picked(tab, "Schema")),
    ]);

    await pickFrom(tab, "Instance", "eu");
    const eu = await paramsUntil(tab, (query) => query.get("instance") === "eu");
    const euRows = await listUntil(tab, (rows) => rows.some((row) => row.name === "orders" && row.rows === "80"));
    await ctx.verify("the Instance menu, a region", [
      check("instance=eu is in the URL", eu.get("instance") === "eu", tab.page.url()),
      check("each table counts the rows of eu", euRows.map((row) => `${row.name}:${row.rows}`).sort().join() === "customers:24,order_items:160,orders:80,products:6", euRows.map((row) => `${row.name}:${row.rows}`)),
    ]);

    await pickFrom(tab, "Instance", /^All instances/);
    const every = await paramsUntil(tab, (query) => query.get("instance") === "all");
    const everyRows = await listUntil(tab, (rows) => rows.some((row) => row.name === "orders" && row.rows === "160"));
    await ctx.verify("the Instance menu, all instances", [
      check("instance=all is in the URL", every.get("instance") === "all", tab.page.url()),
      check("each table counts the rows of every instance", everyRows.map((row) => `${row.name}:${row.rows}`).sort().join() === "customers:48,order_items:320,orders:160,products:18", everyRows.map((row) => `${row.name}:${row.rows}`)),
    ]);

    await pickFrom(tab, "Instance", "default");
    const back = await paramsUntil(tab, (query) => !query.has("instance"));
    const backRows = await listUntil(tab, (rows) => rows.some((row) => row.name === "products" && row.rows === "6") && rows.some((row) => row.name === "orders" && row.rows === "0"));
    await ctx.verify("the Instance menu, default", [
      check("the default instance leaves no instance key", !back.has("instance") && back.get("scope") === "shop", tab.page.url()),
      check("the rows are the default instance's", backRows.map((row) => `${row.name}:${row.rows}`).sort().join() === "customers:0,order_items:0,orders:0,products:6", backRows.map((row) => `${row.name}:${row.rows}`)),
    ]);

    await tab.fill(SEARCH, "ORDER");
    const searched = await paramsUntil(tab, (query) => query.get("q") === "ORDER");
    const searchRows = await listUntil(tab, (rows) => rows.length === 2);
    await ctx.verify("the search", [
      check("q is in the URL as typed", searched.get("q") === "ORDER", tab.page.url()),
      check("it matches table names in any case", names(searchRows) === "order_items,orders", names(searchRows)),
      check("the count follows", (await countText(tab)) === `2 of ${all} tables`, await countText(tab)),
    ]);
    await tab.fill(SEARCH, "email");
    await listUntil(tab, (rows) => names(rows) === "customers");
    await ctx.verify("the search names a column", [check("email finds customers", names(await listed(tab)) === "customers", names(await listed(tab)))]);
    await tab.fill(SEARCH, "ORDER");
    await listUntil(tab, (rows) => rows.length === 2);

    await tab.click({ role: "button", name: "With relations", within: BAR });
    const related = await paramsUntil(tab, (query) => query.get("has") === "relations");
    await tab.click({ role: "button", name: "Empty", within: BAR });
    const relatedEmpty = await paramsUntil(tab, (query) => query.get("has") === "relations,empty");
    const emptyRows = await listUntil(tab, (rows) => rows.length === 2);
    await ctx.verify("the chips", [
      check("With relations sets has=relations", related.get("has") === "relations", tab.page.url()),
      check("the chip is pressed", (await pressed(tab, "With relations")) === "true", await pressed(tab, "With relations")),
      check("the other chips are not", (await pressed(tab, "With modifiers")) === "false" && (await pressed(tab, "Empty")) === "true", [await pressed(tab, "With modifiers"), await pressed(tab, "Empty")]),
      check("Empty adds itself to has", relatedEmpty.get("has") === "relations,empty", tab.page.url()),
      check("both order tables have no row in the default instance", names(emptyRows) === "order_items,orders", names(emptyRows)),
    ]);
    await tab.click({ role: "button", name: "With modifiers", within: BAR });
    const three = await paramsUntil(tab, (query) => query.get("has") === "relations,modifiers,empty");
    const none = await listUntil(tab, (rows) => rows.length === 0);
    await ctx.verify("the chips combine and a filter can match nothing", [
      check("the flags keep their fixed order", three.get("has") === "relations,modifiers,empty", tab.page.url()),
      check("no table of shop has modifiers", none.length === 0, none.length),
      check("the count says 0", (await countText(tab)) === `0 of ${all} tables`, await countText(tab)),
    ]);
    await tab.click({ role: "button", name: "With modifiers", within: BAR });
    const off = await paramsUntil(tab, (query) => query.get("has") === "relations,empty");
    await ctx.verify("a chip toggles off", [check("has loses the flag", off.get("has") === "relations,empty" && (await pressed(tab, "With modifiers")) === "false", tab.page.url())]);
  },
};

/** @type {JourneyDef} */
export const restored = {
  id: "the-url-restores-every-filter-after-a-reload-and-clear-removes-them",
  title: "a URL carrying every filter opens the bar and the list in that state, a reload keeps it, Clear removes every key, Escape empties the search, and another schema drops a named instance",
  entryPoint: "/modules/database/schemas?scope=&instance=&q=&has=",
  async run(ctx) {
    const all = await registered(ctx);
    const tab = await openSchemas(ctx, "?scope=shop&instance=eu&q=order&has=relations");
    const state = async () => ({
      schema: await picked(tab, "Schema"),
      instance: await picked(tab, "Instance"),
      search: await tab.page.getByRole("textbox", { name: "Find a table or column" }).inputValue(),
      relations: await pressed(tab, "With relations"),
      modifiers: await pressed(tab, "With modifiers"),
      rows: (await listed(tab)).map((row) => `${row.name}:${row.rows}`).sort().join(),
      count: await countText(tab),
    });
    const opened = await state();
    await ctx.verify("a shared link opens in its state", [
      check("the Schema menu shows shop", opened.schema.includes("shop"), opened),
      check("the Instance menu shows eu", opened.instance.includes("eu"), opened),
      check("the search holds order", opened.search === "order", opened),
      check("only With relations is pressed", opened.relations === "true" && opened.modifiers === "false", opened),
      check("the list is the filtered one with eu's rows", opened.rows === "order_items:160,orders:80", opened),
      check("the count reads 2 of the registered tables", opened.count === `2 of ${all} tables`, opened),
    ]);
    await tab.reload();
    await tab.page.waitForTimeout(1500);
    const reloaded = await state();
    await ctx.verify("a reload keeps the state", [
      check("the bar and the list are the same", JSON.stringify(reloaded) === JSON.stringify(opened), [reloaded, opened]),
      check("the URL still carries the four keys", ["scope", "instance", "q", "has"].every((key) => params(tab).has(key)), tab.page.url()),
    ]);

    await pickFrom(tab, "Schema", "vault");
    const vault = await paramsUntil(tab, (query) => query.get("scope") === "vault");
    await ctx.verify("another schema drops the named instance of the previous one", [
      check("scope is vault and instance is gone", vault.get("scope") === "vault" && !vault.has("instance"), tab.page.url()),
      check("the other keys stay", vault.get("q") === "order" && vault.get("has") === "relations", tab.page.url()),
    ]);

    await tab.goto("/modules/database/schemas?scope=shop&instance=all&q=order");
    await settled(tab);
    await pickFrom(tab, "Schema", "vault");
    const kept = await paramsUntil(tab, (query) => query.get("scope") === "vault");
    await ctx.verify("the all-instances choice survives another schema", [check("instance=all stays", kept.get("instance") === "all", tab.page.url())]);

    await tab.fill(SEARCH, "zzz");
    await paramsUntil(tab, (query) => query.get("q") === "zzz");
    await tab.press("Escape", SEARCH);
    const escaped = await paramsUntil(tab, (query) => !query.has("q"));
    await ctx.verify("Escape empties the search", [
      check("q leaves the URL", !escaped.has("q"), tab.page.url()),
      check("the field is empty", (await tab.page.getByRole("textbox", { name: "Find a table or column" }).inputValue()) === "", "field"),
    ]);

    await tab.click({ role: "button", name: "Clear", exact: true, within: BAR });
    const cleared = await paramsUntil(tab, (query) => !["scope", "instance", "q", "has"].some((key) => query.has(key)));
    const everything = await listUntil(tab, (rows) => rows.length > 30);
    await ctx.verify("Clear removes every filter", [
      check("no filter key is left", !["scope", "instance", "q", "has"].some((key) => cleared.has(key)), tab.page.url()),
      check("the menus read All schemas and default", (await picked(tab, "Schema")).includes("All schemas") && (await picked(tab, "Instance")).includes("default"), [await picked(tab, "Schema"), await picked(tab, "Instance")]),
      check("the list holds every schema's tables", everything.length > 30, everything.length),
      check("the count is hidden again", (await countText(tab)) === "", await countText(tab)),
      check("no chip is pressed", (await pressed(tab, "With relations")) === "false" && (await pressed(tab, "Empty")) === "false", "chips"),
    ]);
  },
};

/** @type {JourneyDef} */
export const slash = {
  id: "slash-focuses-the-search-field-but-not-while-typing-or-with-a-modifier",
  title: "pressing / on the page focuses Find a table or column, a / typed in a field stays a character, and Ctrl / does not focus it",
  entryPoint: "/modules/database/schemas keyboard",
  async run(ctx) {
    const tab = await openSchemas(ctx);
    const focused = () => tab.page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName ?? "");
    await tab.click({ role: "heading", name: "Schemas", exact: true });
    await tab.page.keyboard.press("Control+/");
    const withModifier = await focused();
    await tab.page.keyboard.press("/");
    await tab.page.waitForTimeout(300);
    const afterSlash = await focused();
    await tab.page.keyboard.type("/x");
    await tab.page.waitForTimeout(500);
    const value = await tab.page.getByRole("textbox", { name: "Find a table or column" }).inputValue();
    await ctx.verify("the slash shortcut", [
      check("Ctrl / does not focus the field", withModifier !== "Find a table or column", withModifier),
      check("/ focuses Find a table or column", afterSlash === "Find a table or column", afterSlash),
      check("the pressed / does not enter the field, a typed one does", value === "/x", value),
      check("the typed text filters the list", params(tab).get("q") === "/x" || (await paramsUntil(tab, (query) => query.get("q") === "/x")).get("q") === "/x", tab.page.url()),
    ]);
  },
};

/** @type {JourneyDef} */
export const noResult = {
  id: "a-filter-that-matches-nothing-says-no-result-and-clear-filters-restores-the-list",
  title: "filters matching no table show No result with No table matches these filters., and Clear filters opens the bare Schemas page",
  entryPoint: "/modules/database/schemas?q=",
  async run(ctx) {
    const all = await registered(ctx);
    const tab = await openSchemas(ctx, "?scope=shop&has=modifiers&q=ord");
    await tab.page.getByText("No result").first().waitFor({ state: "visible", timeout: 20_000 });
    await ctx.verify("the empty state", [
      tab.shows(/No result/),
      tab.shows(/No table matches these filters\./),
      tab.visible({ role: "link", name: "Clear filters" }),
      check("the bar counts 0", (await countText(tab)) === `0 of ${all} tables`, await countText(tab)),
      check("no row is listed", (await listed(tab)).length === 0, (await listed(tab)).length),
    ]);
    await tab.click({ role: "link", name: "Clear filters" });
    const bare = await listUntil(tab, (rows) => rows.length > 30);
    await ctx.verify("Clear filters", [
      check("the page is the bare Schemas page", new URL(tab.page.url()).pathname === "/modules/database/schemas" && new URL(tab.page.url()).search === "", tab.page.url()),
      check("every table is listed again", bare.length > 30, bare.length),
      tab.shows(/No result/, { not: true, timeoutMs: 3000 }),
    ]);
  },
};
