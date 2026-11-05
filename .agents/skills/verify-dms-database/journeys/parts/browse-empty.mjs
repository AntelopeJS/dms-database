import { guarded } from "../../guard.mjs";
import { check, db, pick, show } from "../../database.mjs";
import { browse, columnValues, openTable, openTabs, rowsOf, settle, toolbarCount, DATA_PAGE } from "./browse.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<Tab>} A signed-in tab
 */
async function signedIn(ctx) {
  const tab = await ctx.tab();
  await tab.signIn("admin");
  return tab;
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The page's visible text on one line
 */
async function pageText(tab) {
  return (await tab.page.locator("body").innerText()).replace(/\s+/g, " ");
}

/**
 * Closes every open tab of the data browser.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<void>}
 */
async function closeAll(tab) {
  for (let remaining = (await openTabs(tab)).length; remaining > 0; remaining -= 1) {
    await tab.page.getByRole("button", { name: "Close tab" }).first().click();
    await settle(() => openTabs(tab), (tabs) => tabs.length === remaining - 1);
  }
}

/**
 * The entries of the Recently opened list.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} Each entry's schema.table and instance badge
 */
async function recentEntries(tab) {
  const labels = await tab.page.locator("section button.font-mono").allInnerTexts();
  return labels.map((label) => label.replace(/\s+/g, " ").trim().replace(/ (this minute|just now|now|\d+ \S+ ago)$/, ""));
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const recent = {
  id: "recently-opened-tables-are-offered-when-no-tab-is-open",
  title: "the first visit says Pick a table to browse with no history, and once tabs were opened and closed the page lists the last five opened tables, most recent first, which a click reopens and a reload keeps",
  entryPoint: "/modules/database/data with no open table",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await signedIn(ctx);
    await tab.goto(DATA_PAGE);
    await tab.visible({ role: "textbox", name: "Find a table" }, { timeoutMs: 60_000 });
    const first = await tab.shows(/Pick a table to browse[\s\S]*Choose a table on the left to see its rows\./);
    const noHistory = await tab.shows(/Recently opened/, { not: true, timeoutMs: 3_000 });
    /** @type {[string, string, string | undefined][]} */
    const opened = [["shop", "products", undefined], ["shop", "orders", "eu"], ["shop", "customers", "us"], ["metrics", "readings", undefined], ["demo", "posts", undefined], ["metrics", "empty_log", undefined]];
    for (const [schema, table, instance] of opened) await openTable(tab, schema, table, instance);
    await closeAll(tab);
    const empty = await pageText(tab);
    const entries = await settle(() => recentEntries(tab), (list) => list.length === 5);
    await tab.page.reload();
    await tab.visible({ role: "textbox", name: "Find a table" }, { timeoutMs: 60_000 });
    const afterReload = await settle(() => recentEntries(tab), (list) => list.length === 5);
    await tab.page.locator("section button.font-mono").nth(2).click();
    const reopened = await settle(() => openTabs(tab), (tabs) => tabs.length === 1);
    await ctx.verify("the history", [
      check("a first visit asks to pick a table", first.pass, first.detail),
      check("no history yet: no Recently opened", noHistory.pass, noHistory.detail),
      check("with a history the text offers the tables opened lately", /Pick a table to browse Choose a table on the left, or start from one you opened lately\. Recently opened/i.test(empty), empty.slice(-400)),
      check("five entries, most recent first, the oldest of six dropped", show(entries) === '["metrics.empty_log","demo.posts","metrics.readings","shop.customers @us","shop.orders @eu"]', entries),
      check("a reload keeps the list", show(afterReload) === show(entries), afterReload),
      check("a click reopens that table as a kept tab", show(reopened) === '[{"label":"metrics.readings","preview":false,"active":true}]' || (reopened.length === 1 && reopened[0]?.label === "readings" && reopened[0]?.preview === false), reopened),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const noMatch = {
  id: "no-match-and-empty-tables-say-so",
  title: "a search without a match says No row matches with Clear filters and Search all instances, All instances offers Clear filters only, a table without rows says it has none, and refreshing a refused read shows Couldn't load with Try again until the read works",
  entryPoint: "/modules/database/data empty and error states",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await signedIn(ctx);
    await openTable(tab, "shop", "orders", "eu");
    await tab.fill({ role: "textbox", name: "Search rows" }, "zzz-no-such-text");
    await tab.visible({ role: "heading", name: "No row matches" }, { timeoutMs: 20_000 });
    const body = await pageText(tab);
    const clear = await tab.visible({ role: "button", name: "Clear filters" });
    const searchAll = await tab.visible({ role: "button", name: "Search all instances" });
    await tab.click({ role: "button", name: "Search all instances" });
    const inAll = await settle(() => openTabs(tab), (tabs) => tabs.length === 1 && tabs[0]?.label === "orders @all");
    await tab.visible({ role: "heading", name: "No row matches" }, { timeoutMs: 20_000 });
    const noSearchAll = await tab.visible({ role: "button", name: "Search all instances" }, { hidden: true, timeoutMs: 3_000 });
    await tab.click({ role: "button", name: "Clear filters" });
    const back = await settle(() => toolbarCount(tab), (content) => content === "160 rows");
    const searchBox = await tab.value({ role: "textbox", name: "Search rows" });
    await ctx.verify("No row matches", [
      check("the heading and the hint about another instance", /No row matches/.test(body) && /Searched \d+ rows? in orders\. The row may live in another instance\./.test(body), body.slice(0, 600)),
      check("Clear filters and Search all instances are offered", clear.pass && searchAll.pass, [clear.detail, searchAll.detail]),
      check("Search all instances switches the tab to All instances in place", show(inAll) === '[{"label":"orders @all","preview":false,"active":true}]', inAll),
      check("in All instances only Clear filters remains", noSearchAll.pass, noSearchAll.detail),
      check("Clear filters empties the search and brings the 160 rows back", back === "160 rows" && searchBox === "", [back, searchBox]),
    ]);
    await openTable(tab, "metrics", "empty_log");
    await tab.visible({ role: "heading", name: "empty_log has no row yet" }, { timeoutMs: 20_000 });
    const noRows = await pageText(tab);
    const count = await toolbarCount(tab);
    await ctx.verify("a table without rows", [
      check("empty_log has no row yet, with the hint", /empty_log has no row yet/.test(noRows) && /Rows written by your modules show up here\./.test(noRows) && count === "0 rows", [count, noRows.slice(0, 300)]),
      check("a filter-free empty table offers no Clear filters", !/Clear filters/.test(noRows), noRows.slice(0, 300)),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const loadError = {
  id: "a-refused-read-shows-the-error-and-try-again-reads-it-again",
  title: "an unknown table in a link, or a read the server refuses, shows Couldn't load with the server's message, Try again and Check connection; Try again reads the rows again once the read works",
  entryPoint: "/modules/database/data?schema=shop&table=nope",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await signedIn(ctx);
    await openTable(tab, "shop", "nope").catch(() => undefined);
    await tab.visible({ role: "heading", name: "Couldn't load nope" }, { timeoutMs: 30_000 });
    const unknown = await pageText(tab);
    const href = await tab.page.getByRole("link", { name: "Check connection" }).getAttribute("href");
    await ctx.verify("an unknown table", [
      check("Couldn't load nope with the kept-state hint and the refused read's status", /Couldn't load nope/.test(unknown) && /Your filters and unsaved changes are kept\./.test(unknown) && /404 Not Found/.test(unknown), unknown.slice(unknown.indexOf("Couldn't load"))),
      check("Try again is offered and Check connection links to the Overview", (await tab.visible({ role: "button", name: "Try again" })).pass && href === "/modules/database/overview", href),
    ]);
    await openTable(tab, "metrics", "readings");
    await settle(() => toolbarCount(tab), (content) => content === "1,250 rows");
    await tab.page.route("**/api/database/browse/list**", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Database unreachable" }) });
    });
    await tab.click({ role: "button", name: "Refresh (R)" });
    await tab.visible({ role: "heading", name: "Couldn't load readings" }, { timeoutMs: 30_000 });
    const refused = await pageText(tab);
    await tab.page.unroute("**/api/database/browse/list**");
    await tab.click({ role: "button", name: "Try again" });
    await tab.visible({ role: "heading", name: "Couldn't load readings" }, { hidden: true, timeoutMs: 30_000 });
    const rows = await settle(() => columnValues(tab, "seq"), (values) => values.length === 50);
    await ctx.verify("a refused read", [
      check("the refused read shows the error title and its status", /Couldn't load readings/.test(refused) && /500 Internal Server Error/.test(refused), refused.slice(refused.indexOf("Couldn't load"))),
      check("Try again reads the 50 rows of the page again", rows.length === 50, rows.length),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const refresh = {
  id: "r-refreshes-the-rows-and-the-search-shortcut-works-from-the-grid",
  title: "R and the Refresh button read the page again, showing a change another writer made; R typed in a field is text; Ctrl / focuses Search rows from a focused cell",
  entryPoint: "/modules/database/data keyboard shortcuts",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await signedIn(ctx);
    await openTable(tab, "shop", "products", "eu");
    await settle(() => columnValues(tab, "name"), (values) => values.includes("Desk lamp"));
    const written = await db(ctx, "another writer renames the lamp", "PUT", "/browse/edit?filter_schema=is:shop&filter_table=is:products&filter_instance=is:eu&id=eu_sku_lamp", { body: { name: "Reading lamp" } });
    await tab.page.waitForTimeout(1500);
    const stale = await columnValues(tab, "name");
    await tab.page.getByRole("cell", { name: "eu_sku_lamp", exact: true }).click();
    await tab.press("r");
    const afterR = await settle(() => columnValues(tab, "name"), (values) => values.includes("Reading lamp"));
    const second = await db(ctx, "another writer renames it again", "PUT", "/browse/edit?filter_schema=is:shop&filter_table=is:products&filter_instance=is:eu&id=eu_sku_lamp", { body: { name: "Floor lamp" } });
    await tab.click({ role: "button", name: "Refresh (R)" });
    const afterButton = await settle(() => columnValues(tab, "name"), (values) => values.includes("Floor lamp"));
    await tab.press("Control+/");
    const focus = await tab.page.evaluate(() => document.activeElement?.getAttribute("placeholder") ?? "");
    await tab.page.keyboard.type("r");
    const typed = await tab.value({ role: "textbox", name: "Search rows" });
    const stored = await browse(ctx, "the product", "get", "shop.products", { filter_instance: "is:eu", id: "eu_sku_lamp" });
    await ctx.verify("refreshing", [
      check("the other writer's change is stored", written.status === 200 && second.status === 200 && pick(stored.body, "name") === "Floor lamp", [written.status, second.status, pick(stored.body, "name")]),
      check("the grid does not change by itself", stale.includes("Desk lamp") && !stale.includes("Reading lamp"), stale),
      check("R on a focused cell reads the page again", afterR.includes("Reading lamp"), afterR),
      check("the Refresh button does too", afterButton.includes("Floor lamp") && !afterButton.includes("Reading lamp"), afterButton),
      check("Ctrl / from the grid focuses Search rows", focus === "Search rows", focus),
      check("a letter typed in the field is text, not a shortcut", typed === "r", typed),
      check("the search narrows the rows by the typed letter", rowsOf(await browse(ctx, "search r", "list", "shop.products", { filter_instance: "is:eu", search: "r" })).length > 0, "search r"),
    ]);
  },
};

export const emptyJourneys = guarded([recent, noMatch, loadError, refresh]);
