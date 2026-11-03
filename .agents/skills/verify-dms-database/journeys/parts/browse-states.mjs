import { guarded } from "../../guard.mjs";
import { check, db, isRow, pick, show, text } from "../../database.mjs";
import { browse, columnNames, columnValues, DATA_PAGE, openTable, openTabs, rowsOf, settle, sidebarTables, toolbarCount } from "./browse.mjs";
import { drawerHeader, openRowOf } from "./browse-row.mjs";

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
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The text of the console's query editor
 */
async function consoleSource(tab) {
  return settle(
    async () => (await tab.page.locator(".cm-content").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim(),
    (content) => content !== "",
  );
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<void>}
 */
async function backToTheBrowser(tab) {
  await tab.goto(DATA_PAGE);
  await tab.visible({ role: "textbox", name: "Find a table" }, { timeoutMs: 60_000 });
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} What the Schema and Instance pickers show
 */
async function pickers(tab) {
  const schema = await tab.page.getByRole("button", { name: "Schema", exact: true }).innerText();
  const instance = await tab.page.getByRole("button", { name: "Instance", exact: true }).innerText();
  return `${schema.trim()}/${instance.trim()}`;
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const links = {
  id: "links-open-the-table-in-the-instance-they-name",
  title: "?schema=shop&table=products opens the table in the default instance, instance=eu or us in that instance, instance=all across every instance, a schema alone only picks the schema, and Open in query console carries the table and its instance",
  entryPoint: "/modules/database/data?schema=<schema>&table=<table>&instance=<name>",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await signedIn(ctx);
    await openTable(tab, "shop", "products");
    const products = await settle(() => toolbarCount(tab), (content) => content === "6 rows");
    const productTabs = await openTabs(tab);
    const productPickers = await pickers(tab);
    await openTable(tab, "shop", "orders", "eu");
    const eu = await settle(() => toolbarCount(tab), (content) => content === "80 rows");
    const euTabs = await openTabs(tab);
    const euPickers = await pickers(tab);
    await openTable(tab, "shop", "orders", "us");
    const us = await settle(() => pickers(tab), (content) => content === "shop/us");
    const usIds = await columnValues(tab, "_id");
    await openTable(tab, "shop", "orders", "all");
    const all = await settle(() => toolbarCount(tab), (content) => content === "160 rows");
    const allTabs = await openTabs(tab);
    const allPickers = await pickers(tab);
    await ctx.verify("a table link", [
      check("the default instance: products has 6 rows, one kept tab without a badge", products === "6 rows" && show(productTabs) === '[{"label":"products","preview":false,"active":true}]', [products, productTabs]),
      check("the pickers show shop and default", productPickers === "shop/default", productPickers),
      check("instance=eu: orders has 80 rows, tab orders @eu", eu === "80 rows" && euTabs.at(-1)?.label === "orders @eu" && euTabs.at(-1)?.preview === false, [eu, euTabs]),
      check("the pickers show shop and eu", euPickers === "shop/eu", euPickers),
      check("instance=us: the rows are us_ord ids", us === "shop/us" && usIds.length > 0 && usIds.every((id) => id.startsWith("us_ord_")), [us, usIds.slice(0, 2)]),
      check("instance=all: orders has 160 rows across both regions, tab orders @all", all === "160 rows" && allTabs.at(-1)?.label === "orders @all", [all, allTabs]),
      check("the picker shows All instances", /All instances/.test(allPickers), allPickers),
    ]);
    const other = await signedIn(ctx);
    await other.goto(`${DATA_PAGE}?schema=metrics`);
    await other.visible({ role: "textbox", name: "Find a table" }, { timeoutMs: 60_000 });
    const listed = await settle(() => sidebarTables(other), (tables) => tables.readings === "1,250");
    const noTable = await other.shows(/Pick a table to browse/);
    await ctx.verify("a schema alone", [
      check("it picks the schema and lists its tables", show(listed) === '{"readings":"1,250","empty_log":"0"}', listed),
      check("no table opens: Pick a table to browse", noTable.pass && (await openTabs(other)).length === 0, noTable.detail),
    ]);
    await openTable(tab, "shop", "orders", "eu");
    await tab.click({ role: "button", name: "Open in query console" });
    await tab.at(/\/modules\/database\/query$/);
    const source = await consoleSource(tab);
    await backToTheBrowser(tab);
    await openTable(tab, "shop", "products");
    await tab.click({ role: "button", name: "Open in query console" });
    await tab.at(/\/modules\/database\/query$/);
    const defaultSource = await consoleSource(tab);
    await backToTheBrowser(tab);
    await openTable(tab, "shop", "customers", "all");
    await tab.click({ role: "button", name: "Open in query console" });
    await tab.at(/\/modules\/database\/query$/);
    const allSource = await consoleSource(tab);
    await ctx.verify("Open in query console", [
      check("eu: the table of that instance, 100 rows", source === 'schemas.shop.instance("eu").table("orders").slice(0, 100)', source),
      check("default: the default instance", defaultSource === 'schemas.shop.instance().table("products").slice(0, 100)', defaultSource),
      check("all: the default instance, the console has no cross-instance table", allSource === 'schemas.shop.instance().table("customers").slice(0, 100)', allSource),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const allInstances = {
  id: "all-instances-is-a-read-only-view-with-the-instance-column",
  title: "All instances reads the table across every instance with an _instance column, a Read-only. banner offers Switch to each instance, no cell can be edited, the drawer is read-only without a footer or a Referenced by tab, the edit route refuses 400, and switching keeps the search",
  entryPoint: "/modules/database/data?schema=shop&table=customers&instance=all",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await signedIn(ctx);
    await openTable(tab, "shop", "customers", "eu");
    const euColumns = await columnNames(tab);
    await tab.page.locator("tbody tr").nth(1).locator("td").nth(2).click();
    await tab.press("Enter");
    const euEditor = await tab.visible({ role: "textbox", name: "Value of email" }, { timeoutMs: 5_000 });
    await tab.press("Escape");
    await openTable(tab, "shop", "customers", "all");
    const rows = await settle(() => toolbarCount(tab), (content) => content === "48 rows");
    const columns = await columnNames(tab);
    const banner = await settle(() => pageText(tab), (content) => /Read-only\.\s*You're reading customers across every instance\. Pick one instance to edit\./.test(content));
    const switches = await tab.page.getByRole("button", { name: /^Switch to / }).allInnerTexts();
    const instanceCells = await columnValues(tab, "_instance");
    await tab.page.locator("tbody tr").nth(1).locator("td").nth(2).click();
    await tab.press("Enter");
    const noEditor = await tab.visible({ role: "textbox", name: /^Value of/ }, { hidden: true, timeoutMs: 3_000 });
    await tab.page.locator("tbody tr").nth(1).locator("td").nth(2).dblclick();
    const noEditorDouble = await tab.visible({ role: "textbox", name: /^Value of/ }, { hidden: true, timeoutMs: 3_000 });
    const refused = await db(ctx, "edit across all instances", "PUT", "/browse/edit?filter_schema=is:shop&filter_table=is:customers&filter_instance=is:__CROSS_INSTANCE__&id=eu_cus_001", { body: { company: "Hacked" } });
    const after = await browse(ctx, "the customer", "get", "shop.customers", { filter_instance: "is:eu", id: "eu_cus_001" });
    await ctx.verify("the read-only view", [
      check("the instance column is hidden in a single instance and shown in All instances", !euColumns.includes("_instance") && columns.includes("_instance"), [euColumns, columns]),
      check("a single instance does open the editor on Enter", euEditor.pass, euEditor.detail),
      check("48 rows: the customers of eu and us", rows === "48 rows" && instanceCells.filter((cell) => cell === "eu").length === 24 && instanceCells.filter((cell) => cell === "us").length === 24, [rows, instanceCells.length]),
      check("the banner says Read-only. and what to do", /Read-only\.\s*You're reading customers across every instance\. Pick one instance to edit\./.test(banner), banner.slice(-300)),
      check("the banner offers Switch to eu, us and default", show(switches) === '["Switch to eu","Switch to us","Switch to default"]', switches),
      check("Enter on a cell opens no editor", noEditor.pass, noEditor.detail),
      check("a double-click opens no editor", noEditorDouble.pass, noEditorDouble.detail),
      check("the edit route refuses with 400 and says why", refused.status === 400 && /Editing is disabled when browsing across all instances/.test(isRow(refused.body) ? text(refused.body, "message") : String(refused.body)), [refused.status, refused.body]),
      check("the row is unchanged", pick(after.body, "company") !== "Hacked", pick(after.body, "company")),
    ]);
    await openRowOf(tab, "eu_cus_001");
    const header = await settle(() => drawerHeader(tab), (content) => content.title === "eu_cus_001");
    const dialog = tab.page.getByRole("dialog");
    const drawerTabs = await dialog.getByRole("tab").allInnerTexts();
    const inputs = await dialog.getByRole("textbox").count();
    const nulls = await dialog.getByRole("button", { name: "Set to null" }).count();
    const footers = await tab.page.locator("[data-row-footer]").count();
    await ctx.verify("the read-only drawer", [
      check("the drawer opens on the row, in the instance order", header.title === "eu_cus_001" && /^Row \d+ of 48$/.test(header.position), header),
      check("tabs: Fields and JSON, no Referenced by", show(drawerTabs.map((label) => label.replace(/\s+/g, " ").trim().replace(/ \d+$/, ""))) === '["Fields","JSON"]', drawerTabs),
      check("no field is editable: no text box, no Set to null, no footer", inputs === 0 && nulls === 0 && footers === 0, [inputs, nulls, footers]),
    ]);
    await tab.press("Escape");
    await tab.fill({ role: "textbox", name: "Search rows" }, "cus_01");
    await settle(() => toolbarCount(tab), (content) => content === "20 rows");
    await tab.click({ role: "button", name: "Switch to us" });
    const switched = await settle(() => openTabs(tab), (tabs) => tabs.at(-1)?.label === "customers @us");
    const usRows = await settle(() => toolbarCount(tab), (content) => content === "10 rows");
    const search = await tab.value({ role: "textbox", name: "Search rows" });
    const noBanner = await tab.shows(/Read-only\./, { not: true, timeoutMs: 5_000 });
    const idsUs = await columnValues(tab, "_id");
    await ctx.verify("Switch to an instance", [
      check("the tab becomes customers @us in place", show(switched.map((entry) => entry.label)) === '["customers @eu","customers @us"]' && switched[1]?.active === true, switched),
      check("the search is kept: cus_01 matches 10 customers of us", search === "cus_01" && usRows === "10 rows" && idsUs.every((id) => id.startsWith("us_cus_01")), [search, usRows, idsUs]),
      check("the banner is gone", noBanner.pass, noBanner.detail),
    ]);
    const apiAll = await browse(ctx, "every customer", "list", "shop.customers", { filter_instance: "is:__CROSS_INSTANCE__", search: "cus_01", limit: 50 });
    await ctx.verify("the same search through the API", [check("20 matches across both instances", pick(apiAll.body, "total") === 20 && rowsOf(apiAll).length === 20, pick(apiAll.body, "total"))]);
  },
};

export const stateJourneys = guarded([links, allInstances]);
