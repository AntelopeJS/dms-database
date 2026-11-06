import { guarded } from "../../guard.mjs";
import { check, isRow, parseJson, pick, show, text } from "../../database.mjs";
import { browse, filterChips, openTable, openTabs, settle, toolbarCount } from "./browse.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */

/**
 * Signs in, opens a table, sorts it by its id and waits for the rows.
 *
 * @param {Ctx} ctx The journey
 * @param {string} schema The schema
 * @param {string} table The table
 * @param {string} [instance] The instance parameter
 * @returns {Promise<Tab>} The tab
 */
async function sortedBrowser(ctx, schema, table, instance) {
  const tab = await ctx.tab();
  await tab.signIn("admin");
  await openTable(tab, schema, table, instance);
  await tab.click({ role: "button", name: "_id", exact: true });
  await tab.page.locator("tbody tr").first().waitFor({ state: "visible" });
  return tab;
}

/**
 * Focuses a cell of the grid by its text and opens its row with Space.
 *
 * @param {Tab} tab The tab
 * @param {string} cell The text of a cell of the row
 * @returns {Promise<void>}
 */
export async function openRowOf(tab, cell) {
  await tab.click({ role: "cell", name: cell, exact: true });
  await tab.press(" ");
  await tab.visible({ role: "dialog" });
}

/**
 * The drawer's heading and its position.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<{ title: string, position: string }>} The row's title and the "Row 3 of 50" text
 */
export async function drawerHeader(tab) {
  const dialog = tab.page.getByRole("dialog");
  const title = (await dialog.getByRole("heading").first().innerText().catch(() => "")).trim();
  const text = await dialog.innerText().catch(() => "");
  return { title, position: /Row \d+ of \d+/.exec(text)?.[0] ?? "" };
}

/**
 * @param {Tab} tab The tab
 * @param {string} title The row the drawer must show
 * @returns {Promise<{ title: string, position: string }>} The header once it names the row
 */
async function drawerAt(tab, title) {
  return settle(() => drawerHeader(tab), (header) => header.title === title);
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const drawerSteps = {
  id: "the-row-drawer-steps-through-the-page-with-j-and-k",
  title: "Space opens the focused row in a drawer headed by its id and 'Row 3 of 50', J and K and the Previous and Next buttons move one row, the first row has no Previous and the last no Next, and the position counts the rows of the page",
  entryPoint: "/modules/database/data?schema=shop&table=orders&instance=eu",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await sortedBrowser(ctx, "shop", "orders", "eu");
    await openRowOf(tab, "eu_ord_10402");
    const third = await drawerAt(tab, "eu_ord_10402");
    await tab.press("j");
    const fourth = await drawerAt(tab, "eu_ord_10403");
    await tab.press("k");
    await tab.press("k");
    const second = await drawerAt(tab, "eu_ord_10401");
    await tab.click({ role: "button", name: "Next" });
    const nextRow = await drawerAt(tab, "eu_ord_10402");
    await tab.click({ role: "button", name: "Previous" });
    const previousRow = await drawerAt(tab, "eu_ord_10401");
    await ctx.verify("moving between rows", [
      check("Space opens eu_ord_10402 as Row 3 of 50", show(third) === '{"title":"eu_ord_10402","position":"Row 3 of 50"}', third),
      check("J moves to the next row: Row 4 of 50", show(fourth) === '{"title":"eu_ord_10403","position":"Row 4 of 50"}', fourth),
      check("K twice goes back two rows: Row 2 of 50", show(second) === '{"title":"eu_ord_10401","position":"Row 2 of 50"}', second),
      check("the Next button moves forward", show(nextRow) === '{"title":"eu_ord_10402","position":"Row 3 of 50"}', nextRow),
      check("the Previous button moves back", show(previousRow) === '{"title":"eu_ord_10401","position":"Row 2 of 50"}', previousRow),
    ]);
    await tab.press("k");
    const firstRow = await drawerAt(tab, "eu_ord_10400");
    const noPrevious = await tab.enabled({ role: "button", name: "Previous" }, { disabled: true });
    await tab.press("k");
    const stays = await drawerHeader(tab);
    await tab.press("Escape");
    await tab.visible({ role: "dialog" }, { hidden: true });
    await openRowOf(tab, "eu_ord_10449");
    const lastRow = await drawerAt(tab, "eu_ord_10449");
    const noNext = await tab.enabled({ role: "button", name: "Next" }, { disabled: true });
    await tab.press("j");
    const staysLast = await drawerHeader(tab);
    await ctx.verify("the ends of the page", [
      check("the first row reads Row 1 of 50 and has no Previous", firstRow.position === "Row 1 of 50" && noPrevious.pass, [firstRow, noPrevious.detail]),
      check("K on the first row stays on it", stays.title === "eu_ord_10400", stays),
      check("the 50th row reads Row 50 of 50 and has no Next", lastRow.position === "Row 50 of 50" && noNext.pass, [lastRow, noNext.detail]),
      check("J on the last row stays on it", staysLast.title === "eu_ord_10449", staysLast),
    ]);
    await tab.press("Escape");
    await tab.page.getByRole("button", { name: "Next page" }).click();
    await tab.page.locator("tbody tr").nth(29).waitFor({ state: "visible" });
    await openRowOf(tab, "eu_ord_10452");
    const secondPage = await drawerAt(tab, "eu_ord_10452");
    await ctx.verify("the position counts the page", [check("on page 2 the third row reads Row 3 of 30", secondPage.position === "Row 3 of 30", secondPage)]);
  },
};

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The text of the open drawer
 */
async function drawerText(tab) {
  return tab.page.getByRole("dialog").innerText();
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const drawerTabs = {
  id: "the-row-drawer-shows-fields-json-and-the-rows-pointing-at-it",
  title: "the drawer's Fields tab lists every column with its type, the key as not editable and a relation with its link; the JSON tab is the stored row; Referenced by counts, per relation column, the rows pointing at the row and opens that table on them",
  entryPoint: "/modules/database/data row drawer",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await sortedBrowser(ctx, "shop", "orders", "eu");
    await openRowOf(tab, "eu_ord_10402");
    await drawerAt(tab, "eu_ord_10402");
    const fields = await drawerText(tab);
    const tabs = await tab.page.getByRole("dialog").getByRole("tab").allInnerTexts();
    const orderRow = await browse(ctx, "the order", "get", "shop.orders", { filter_instance: "is:eu", id: "eu_ord_10402" });
    const link = await tab.page.getByRole("dialog").getByRole("link", { name: "Open customers" }).getAttribute("href");
    await ctx.verify("the Fields tab", [
      check("three tabs: Fields 10, JSON and Referenced by 2", show(tabs.map((label) => label.replace(/\s+/g, " ").trim())) === '["Fields 10","JSON","Referenced by 2"]', tabs),
      check("the scope names the table and instance", /shop\.orders @eu/.test(fields), fields.slice(0, 120)),
      check("the key is shown as primary key, not editable", /primary key[\s\S]*eu_ord_10402 · not editable/.test(fields), fields.slice(0, 200)),
      check("a column shows its runtime type: number, object, date", /total\s+number/.test(fields) && /shipping\s+object/.test(fields) && /created_at\s+date/.test(fields), fields),
      check("a relation column shows its target table and a link to it", /customer_id\s+customers/.test(fields) && link?.startsWith("/modules/database/data?schema=shop&table=customers&instance=eu&match=_id") === true, link),
      check("the text cells hold the stored values", (await tab.value({ role: "textbox", name: "number" })) === "#10402" && (await tab.value({ role: "textbox", name: "status" })) === text(orderRow.body, "status"), pick(orderRow.body, "status")),
    ]);
    await tab.click({ role: "tab", name: "JSON" });
    const shown = await drawerText(tab);
    const parsed = parseJson(shown.slice(shown.indexOf("{"), shown.lastIndexOf("}") + 1));
    const expected = Object.fromEntries(Object.entries(isRow(orderRow.body) ? orderRow.body : {}).filter(([key]) => key !== "_instance"));
    /** @param {unknown} row @returns {string} */
    const byKey = (row) => show(Object.fromEntries(Object.entries(isRow(row) ? row : {}).sort(([a], [b]) => a.localeCompare(b))));
    await ctx.verify("the JSON tab", [check("it holds the stored row, the instance tag aside, in the grid's column order", byKey(parsed) === byKey(expected), [parsed, expected])]);
    await tab.click({ role: "tab", name: /^Referenced by/ });
    const references = await settle(() => drawerText(tab), (content) => /2 rows · order_id/.test(content));
    await tab.page.getByRole("dialog").getByRole("link", { name: /order_items/ }).click();
    const chips = await settle(() => filterChips(tab), (list) => list.length === 1);
    const count = await settle(() => toolbarCount(tab), (content) => content === "2 rows");
    const opened = await openTabs(tab);
    const noDrawer = await tab.visible({ role: "dialog" }, { hidden: true });
    await ctx.verify("Referenced by", [
      check("an order is pointed at by 2 order_items rows through order_id", /order_items\s+2 rows · order_id/.test(references), references),
      check("the link opens order_items in eu, on the two rows: chip order_id is exactly eu_ord_10402", show(chips) === '["order_id is exactly eu_ord_10402"]' && count === "2 rows" && opened.at(-1)?.label === "order_items @eu", [chips, count, opened]),
      check("the drawer closes on the way out", noDrawer.pass, noDrawer.detail),
    ]);
    await tab.page.goto(`${tab.page.url().split("/modules")[0]}/modules/database/data?schema=shop&table=customers&instance=eu`);
    await tab.visible({ role: "textbox", name: "Search rows" }, { timeoutMs: 60_000 });
    await openRowOf(tab, "eu_cus_000");
    await tab.click({ role: "tab", name: /^Referenced by/ });
    const customer = await settle(() => drawerText(tab), (content) => /4 rows · customer_id/.test(content));
    await ctx.verify("a customer", [check("it is pointed at by 4 orders through customer_id", /orders\s+4 rows · customer_id/.test(customer), customer)]);
    await tab.press("Escape");
    await openTable(tab, "shop", "order_items", "eu");
    await openRowOf(tab, "eu_itm_0");
    await tab.click({ role: "tab", name: /^Referenced by/ });
    const none = await settle(() => drawerText(tab), (content) => /No row of another table points to this one\./.test(content));
    await ctx.verify("a row nothing points to", [check("the tab says so", /No row of another table points to this one\./.test(none), none)]);
  },
};

/**
 * The drawer's field control of a column.
 *
 * @param {Tab} tab The tab
 * @param {string} field The column
 * @param {"input" | "textarea"} kind The control element
 * @returns {Promise<{ width: number, found: boolean }>} Its width
 */
async function controlWidth(tab, field, kind) {
  const box = await tab.page.locator(`[data-field-row="${field}"] ${kind}`).first().boundingBox().catch(() => null);
  return { width: box?.width ?? 0, found: box !== null };
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const drawerFields = {
  id: "the-fields-tab-widens-long-values-and-sets-null-with-the-dashed-circle",
  title: "a long text or a JSON value takes the drawer's width while a short text sits beside its label, the dashed-circle button stages null and the drawer's footer, at the bottom of the drawer, counts the row's unsaved changes",
  entryPoint: "/modules/database/data row drawer, Fields tab",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await sortedBrowser(ctx, "vault", "accounts");
    await openRowOf(tab, "acc_ada");
    await drawerAt(tab, "acc_ada");
    const longText = await controlWidth(tab, "display_name", "textarea");
    const shortText = await controlWidth(tab, "handle", "input");
    const adaShortInput = await controlWidth(tab, "display_name", "input");
    await tab.press("j");
    await drawerAt(tab, "acc_bob");
    const bobShort = await controlWidth(tab, "display_name", "input");
    const bobTextarea = await controlWidth(tab, "display_name", "textarea");
    await ctx.verify("long text takes the width", [
      check("Ada's display name (long, two lines) is a text area, not an input", longText.found && !adaShortInput.found, [longText, adaShortInput]),
      check("the long text is wider than as the short handle", longText.width > shortText.width * 1.5, [longText.width, shortText.width]),
      check("Bob's display name (3 characters) is an input beside its label", bobShort.found && !bobTextarea.found && bobShort.width < longText.width, [bobShort, bobTextarea]),
    ]);
    await tab.press("Escape");
    await openTable(tab, "shop", "orders", "eu");
    await tab.click({ role: "button", name: "_id", exact: true });
    await openRowOf(tab, "eu_ord_10400");
    await drawerAt(tab, "eu_ord_10400");
    const json = await controlWidth(tab, "shipping", "textarea");
    const status = await controlWidth(tab, "status", "input");
    const footer = tab.page.locator("[data-row-footer]");
    const before = (await footer.innerText()).replace(/\s+/g, " ").trim();
    const dialogBox = await tab.page.getByRole("dialog").boundingBox();
    const footerBox = await footer.boundingBox();
    await tab.page.locator('[data-field-row="channel"]').getByRole("button", { name: "Set to null" }).click();
    const one = await settle(async () => (await footer.innerText()).replace(/\s+/g, " ").trim(), (content) => /1 unsaved change/.test(content));
    await tab.page.locator('[data-field-row="status"]').getByRole("button", { name: "Set to null" }).click();
    const two = await settle(async () => (await footer.innerText()).replace(/\s+/g, " ").trim(), (content) => /2 unsaved changes/.test(content));
    const stored = await browse(ctx, "the order", "get", "shop.orders", { filter_instance: "is:eu", id: "eu_ord_10400" });
    const channelNullShown = await tab.page.locator('[data-field-row="channel"] input').first().getAttribute("placeholder");
    const bar = await tab.shows(/2 unsaved changes/);
    await ctx.verify("a JSON value, the dashed circle and the footer", [
      check("the shipping object is a text area wider than as the status input", json.found && json.width > status.width * 1.5, [json, status]),
      check("the footer starts at No unsaved change, with no review button", /No unsaved change/.test(before) && !/Review and save/.test(before), before),
      check("the footer is at the drawer's bottom", dialogBox !== null && footerBox !== null && Math.abs(dialogBox.y + dialogBox.height - (footerBox.y + footerBox.height)) <= 24, [dialogBox, footerBox]),
      check("setting channel to null counts 1 unsaved change and offers Review and save 1 change", /1 unsaved change/.test(one) && /Review and save 1 change/.test(one), one),
      check("a second field makes it 2 unsaved changes", /2 unsaved changes/.test(two) && /Review and save 2 changes/.test(two), two),
      check("a nulled cell shows the null placeholder, without a dashed circle", channelNullShown === "null", channelNullShown),
      check("nothing is written: the stored row keeps channel and status", pick(stored.body, "channel") === "web" && pick(stored.body, "status") === "pending", stored.body),
      check("the grid's own bar counts the changes too", bar.pass, bar.detail),
    ]);
  },
};

export const rowJourneys = guarded([drawerSteps, drawerTabs, drawerFields]);
