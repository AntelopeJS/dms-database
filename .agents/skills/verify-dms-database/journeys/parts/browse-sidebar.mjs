import { guarded } from "../../guard.mjs";
import { check, show } from "../../database.mjs";
import { DATA_PAGE, openTabs, pickInstance, pickSchema, settle, sidebarTables } from "./browse.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */

/**
 * Signs in and opens the data browser with no selection.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<Tab>} The tab
 */
async function emptyBrowser(ctx) {
  const tab = await ctx.tab();
  await tab.signIn("admin");
  await tab.goto(DATA_PAGE);
  await tab.visible({ role: "textbox", name: "Find a table" }, { timeoutMs: 60_000 });
  return tab;
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The sidebar footer's text
 */
async function footerText(tab) {
  return (await tab.page.locator("aside footer").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
}

/**
 * @param {Tab} tab The tab
 * @param {string} instance The instance whose counts the list must show
 * @returns {Promise<string>} The footer once it names the instance
 */
async function countsFor(tab, instance) {
  return settle(() => footerText(tab), (text) => text === `Counts for instance ${instance}`);
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const sidebarCounts = {
  id: "the-sidebar-counts-each-table-in-the-picked-instance",
  title: "picking a schema lists its tables, picking default, a named instance or All instances re-counts every table and the footer names the instance; T finds a table, Esc clears the search and a search with no match says so",
  entryPoint: "/modules/database/data sidebar",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await emptyBrowser(ctx);
    await pickSchema(tab, "shop");
    const inDefault = await settle(() => sidebarTables(tab), (tables) => tables.customers === "0" && tables.products === "6");
    const footerDefault = await countsFor(tab, "default");
    await pickInstance(tab, "eu");
    const inEu = await settle(() => sidebarTables(tab), (tables) => tables.customers === "24");
    const footerEu = await countsFor(tab, "eu");
    await pickInstance(tab, "us");
    const inUs = await settle(() => sidebarTables(tab), (tables) => tables.orders === "80" && tables.customers === "24");
    await pickInstance(tab, "all");
    const inAll = await settle(() => sidebarTables(tab), (tables) => tables.customers === "48");
    const footerAll = await countsFor(tab, "all");
    await ctx.verify("the counts follow the instance", [
      check("default: customers 0, products 6, orders 0, order_items 0", show(inDefault) === '{"customers":"0","products":"6","orders":"0","order_items":"0"}', inDefault),
      check("the footer says Counts for instance default", footerDefault === "Counts for instance default", footerDefault),
      check("eu: customers 24, products 6, orders 80, order_items 160", show(inEu) === '{"customers":"24","products":"6","orders":"80","order_items":"160"}', inEu),
      check("the footer says Counts for instance eu", footerEu === "Counts for instance eu", footerEu),
      check("us counts its own rows: 24 customers, 80 orders", inUs.customers === "24" && inUs.orders === "80", inUs),
      check("All instances: the union, 48 customers, 18 products, 160 orders, 320 order_items", show(inAll) === '{"customers":"48","products":"18","orders":"160","order_items":"320"}', inAll),
      check("the footer says Counts for instance all", footerAll === "Counts for instance all", footerAll),
    ]);
    await pickSchema(tab, "metrics");
    const metrics = await settle(() => sidebarTables(tab), (tables) => tables.readings === "1,250");
    const footerMetrics = await countsFor(tab, "default");
    await pickInstance(tab, "default").catch(() => undefined);
    const instanceButton = (await tab.page.getByRole("button", { name: "Instance", exact: true }).innerText()).trim();
    await tab.page.keyboard.press("Escape");
    await ctx.verify("another schema starts on the default instance and groups digits", [
      check("metrics: 1,250 readings and 0 in empty_log", show(metrics) === '{"readings":"1,250","empty_log":"0"}', metrics),
      check("a schema picked after All instances is back on default", footerMetrics === "Counts for instance default" && /default/.test(instanceButton), [footerMetrics, instanceButton]),
    ]);
    await pickSchema(tab, "shop");
    await settle(() => sidebarTables(tab), (tables) => tables.products === "6");
    await tab.page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await tab.press("t");
    const focusedAfterT = await tab.page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    await tab.page.keyboard.type("items");
    const filtered = await settle(() => sidebarTables(tab), (tables) => Object.keys(tables).length === 1);
    const heading = (await tab.page.locator("aside").innerText()).replace(/\s+/g, " ");
    await tab.page.keyboard.press("Escape");
    const cleared = await settle(() => sidebarTables(tab), (tables) => Object.keys(tables).length === 4);
    await tab.page.keyboard.type("T");
    await tab.page.keyboard.type("zzz");
    const none = await settle(() => tab.page.locator("aside").innerText(), (text) => /No table matches\./.test(text));
    await ctx.verify("T finds a table", [
      check("T focuses the Find a table field", focusedAfterT === "Find a table", focusedAfterT),
      check("typing items keeps order_items alone and counts one table", show(Object.keys(filtered)) === '["order_items"]' && /Tables · 1/i.test(heading), [filtered, heading]),
      check("Esc clears the search: the four tables are back", show(Object.keys(cleared)) === '["customers","products","orders","order_items"]', cleared),
      check("a T typed in the field is text, and a search with no match says No table matches.", /No table matches\./.test(none) && (await tab.value({ role: "textbox", name: "Find a table" })) === "Tzzz", none),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const previewTabs = {
  id: "tables-open-as-preview-tabs-and-are-kept-on-demand",
  title: "a click opens an italic preview tab the next table replaces, a double-click, the pin button, a tab double-click or a modifier click keeps it, the hint line shows while one is open, closing a tab activates its neighbour, the tabs and the preview state survive a reload and the URL names the active tab",
  entryPoint: "/modules/database/data tab bar",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await emptyBrowser(ctx);
    await pickSchema(tab, "shop");
    await pickInstance(tab, "eu");
    await countsFor(tab, "eu");
    const sidebar = (/** @type {string} */ name) => tab.page.locator("aside nav button").filter({ hasText: new RegExp(`^${name}`) });
    await sidebar("customers").click();
    const first = await settle(() => openTabs(tab), (tabs) => tabs.length === 1);
    const hint = await tab.shows(/Italic = preview tab · double-click to keep/);
    await sidebar("orders").click();
    const replaced = await settle(() => openTabs(tab), (tabs) => tabs[0]?.label.startsWith("orders") === true);
    await sidebar("customers").dblclick();
    const kept = await settle(() => openTabs(tab), (tabs) => tabs.length === 1 && tabs[0]?.preview === false);
    await ctx.verify("a click previews, the next click replaces, a double-click keeps", [
      check("one italic tab: customers @eu", show(first) === '[{"label":"customers @eu","preview":true,"active":true}]', first),
      check("the hint line explains the italics", hint.pass, hint.detail),
      check("opening orders replaces the preview: one italic tab orders @eu", show(replaced) === '[{"label":"orders @eu","preview":true,"active":true}]', replaced),
      check("a double-click on customers leaves one kept tab: the preview it replaced is gone", show(kept) === '[{"label":"customers @eu","preview":false,"active":true}]', kept),
    ]);
    const noHint = await tab.shows(/preview tab · double-click to keep/, { not: true, timeoutMs: 5_000 });
    await sidebar("orders").click();
    const two = await settle(() => openTabs(tab), (tabs) => tabs.length === 2);
    const dot = await tab.page.locator("aside nav button [title='Open in a tab']").count();
    await tab.click({ role: "button", name: "Keep tab" });
    const pinned = await settle(() => openTabs(tab), (tabs) => tabs.length === 2 && tabs[1]?.preview === false);
    const pinGone = await tab.count({ role: "button", name: "Keep tab" }, 0);
    await sidebar("order_items").click();
    const third = await settle(() => openTabs(tab), (tabs) => tabs.length === 3);
    await tab.page.locator("[data-tab]").nth(2).locator("button").first().dblclick();
    const byDoubleClick = await settle(() => openTabs(tab), (tabs) => tabs.length === 3 && tabs[2]?.preview === false);
    await sidebar("products").click({ modifiers: ["Control"] });
    const byModifier = await settle(() => openTabs(tab), (tabs) => tabs.length === 4);
    await ctx.verify("the other ways to keep a tab", [
      check("the hint line is gone once no tab is a preview", noHint.pass, noHint.detail),
      check("a second table opens beside the kept tab, italic", show(two.map((entry) => [entry.label, entry.preview])) === '[["customers @eu",false],["orders @eu",true]]', two),
      check("open tables carry a ring in the list, the two opened", dot === 2, dot),
      check("the pin button keeps the preview", show(pinned.map((entry) => entry.preview)) === "[false,false]" && pinGone.pass, pinned),
      check("a third preview opens italic", third[2]?.preview === true && third[2]?.label === "order_items @eu", third),
      check("a double-click on the tab keeps it", show(byDoubleClick.map((entry) => entry.preview)) === "[false,false,false]", byDoubleClick),
      check("a Ctrl-click in the list opens a kept tab, with no new italic", show(byModifier.map((entry) => [entry.label, entry.preview])) === '[["customers @eu",false],["orders @eu",false],["order_items @eu",false],["products @eu",false]]', byModifier),
    ]);
    await sidebar("customers").click();
    const urlActive = new URL(tab.page.url());
    await sidebar("products").click();
    await sidebar("order_items").click();
    await tab.page.locator("[data-tab]").nth(1).locator("button[aria-label='Close tab']").click();
    const afterClose = await settle(() => openTabs(tab), (tabs) => tabs.length === 3);
    await tab.page.locator("[data-tab]").nth(2).locator("button[aria-label='Close tab']").click();
    await settle(() => openTabs(tab), (tabs) => tabs.length === 2);
    const neighbour = await openTabs(tab);
    await sidebar("products").click();
    const withPreview = await settle(() => openTabs(tab), (tabs) => tabs.length === 3 && tabs[2]?.preview === true);
    await tab.page.reload();
    await tab.visible({ role: "textbox", name: "Search rows" }, { timeoutMs: 60_000 });
    const restored = await settle(() => openTabs(tab), (tabs) => tabs.length === 3);
    const urlAfterReload = new URL(tab.page.url());
    await ctx.verify("closing, reloading and the URL", [
      check("the URL names the active tab: schema, table and instance", urlActive.searchParams.get("schema") === "shop" && urlActive.searchParams.get("table") === "customers" && urlActive.searchParams.get("instance") === "eu", urlActive.search),
      check("closing the second tab leaves the other three, the active one unchanged", show(afterClose.map((entry) => entry.label)) === '["customers @eu","order_items @eu","products @eu"]' && afterClose.find((entry) => entry.active)?.label === "order_items @eu", afterClose),
      check("closing the last tab, which was not active, keeps the active tab", neighbour.length === 2 && neighbour.find((entry) => entry.active)?.label === "order_items @eu", neighbour),
      check("a table opened after that is the italic third tab", withPreview[2]?.label === "products @eu", withPreview),
      check("a reload brings the tabs back in order, the preview still italic", show(restored.map((entry) => [entry.label, entry.preview])) === '[["customers @eu",false],["order_items @eu",false],["products @eu",true]]', restored),
      check("the active tab and the URL are back after the reload", urlAfterReload.searchParams.get("table") === "products" && urlAfterReload.searchParams.get("instance") === "eu" && restored.find((entry) => entry.active)?.label === "products @eu", [urlAfterReload.search, restored]),
    ]);
  },
};

export const sidebarJourneys = guarded([sidebarCounts, previewTabs]);
