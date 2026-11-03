import { db, isRow, list } from "../../database.mjs";

/**
 * @typedef {import("../../database.mjs").Ctx} Ctx
 * @typedef {import("../../database.mjs").Tab} Tab
 * @typedef {import("../../database.mjs").Answer} Answer
 * @typedef {import("../../database.mjs").Row} Row
 */

/** The data browser page. */
export const DATA_PAGE = "/modules/database/data";

/** The wire token of the cross-instance selection. */
export const ALL = "__CROSS_INSTANCE__";

/**
 * The query string of a browse request.
 *
 * @param {Record<string, string | number | undefined>} params The parameters, undefined ones left out
 * @returns {string} The query string, with its leading question mark
 */
export function queryString(params) {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return pairs.length === 0 ? "" : `?${pairs.join("&")}`;
}

/**
 * Calls a browse route as the platform owner.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} route The route under `/browse`
 * @param {string} target `schema.table`, or the schema alone for the routes that take no table
 * @param {Record<string, string | number | undefined>} [params] The other parameters, with their wire names
 * @returns {Promise<Answer>} The answer
 */
export function browse(ctx, label, route, target, params = {}) {
  const [schema, table] = target.split(".");
  /** @type {Record<string, string | number | undefined>} */
  const selection = { filter_schema: `is:${schema}` };
  if (table) selection.filter_table = `is:${table}`;
  return db(ctx, label, "GET", `/browse/${route}${queryString({ ...selection, ...params })}`);
}

/**
 * The rows a list route answered.
 *
 * @param {Answer} answer The answer
 * @returns {Row[]} The rows
 */
export function rowsOf(answer) {
  return list(answer.body, "results");
}

/**
 * Opens the data browser on a table through its link and waits for the grid.
 *
 * @param {Tab} tab The signed-in tab
 * @param {string} schema The schema
 * @param {string} table The table
 * @param {string} [instance] The `instance` parameter: a name, `all`, or none for the default instance
 * @returns {Promise<void>}
 */
export async function openTable(tab, schema, table, instance) {
  const query = queryString({ schema, table, instance });
  await tab.goto(`${DATA_PAGE}${query}`);
  await tab.visible({ role: "textbox", name: "Search rows" }, { timeoutMs: 60_000 });
}

/**
 * The text of every cell of the grid's body rows, the row-number cell first.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[][]>} One list of cell texts per row
 */
export async function gridRows(tab) {
  const rows = tab.page.locator("tbody tr");
  const count = await rows.count();
  /** @type {string[][]} */
  const out = [];
  for (let index = 0; index < count; index += 1) {
    out.push((await rows.nth(index).locator("td").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim()));
  }
  return out;
}

/**
 * The column names in the grid's header.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} The names, left to right
 */
export async function columnNames(tab) {
  const names = await tab.page.locator("thead th button[title='Sort by this column']").allInnerTexts();
  return names.map((name) => name.trim());
}

/**
 * One column of the grid, as text.
 *
 * @param {Tab} tab The tab
 * @param {string} column The column name
 * @returns {Promise<string[]>} The column's cell texts, top to bottom
 */
export async function columnValues(tab, column) {
  const names = await columnNames(tab);
  const index = names.indexOf(column);
  if (index < 0) return [];
  const rows = await gridRows(tab);
  return rows.map((cells) => cells[index + 1] ?? "");
}

/**
 * Waits until a condition on the grid holds, polling.
 *
 * @template T
 * @param {() => Promise<T>} read Reads the page
 * @param {(value: T) => boolean} done Whether the read is the awaited one
 * @param {number} [timeoutMs] How long to wait
 * @returns {Promise<T>} The last read
 */
export async function settle(read, done, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await read();
  }
  return value;
}

/**
 * @param {unknown} value Anything
 * @returns {string} Its JSON text without spaces, for comparisons
 */
export function same(value) {
  return JSON.stringify(value);
}

/**
 * The ids of rows, in answer order.
 *
 * @param {Row[]} rows The rows
 * @returns {string[]} Their `_id`
 */
export function ids(rows) {
  return rows.map((row) => (isRow(row) ? String(row._id) : ""));
}

/**
 * Picks a schema in the sidebar's Schema picker.
 *
 * @param {Tab} tab The tab on the data browser
 * @param {string} schema The schema id
 * @returns {Promise<void>}
 */
export async function pickSchema(tab, schema) {
  await tab.click({ role: "button", name: "Schema", exact: true });
  await tab.click({ role: "option", name: schema, exact: true });
}

/**
 * Picks an instance in the sidebar's Instance picker.
 *
 * @param {Tab} tab The tab on the data browser
 * @param {string} instance `default`, `all` or a named instance
 * @returns {Promise<void>}
 */
export async function pickInstance(tab, instance) {
  await tab.click({ role: "button", name: "Instance", exact: true });
  const name = instance === "all" ? /^All instances/ : instance;
  await tab.click({ role: "option", name, exact: instance !== "all" });
}

/**
 * The table list of the sidebar with the row count of each table.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<Record<string, string>>} The count text by table name, empty when no count shows
 */
export async function sidebarTables(tab) {
  const labels = await tab.page.locator("aside nav button").allInnerTexts();
  return Object.fromEntries(
    labels.map((label) => {
      const words = label.replace(/Open in a tab/g, " ").split(/\s+/).filter(Boolean);
      const name = words[0] ?? "";
      const count = words.length > 1 ? (words.at(-1) ?? "") : "";
      return [name, count];
    }),
  );
}

/**
 * The open tabs of the tab bar, in order.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<{ label: string, preview: boolean, active: boolean }[]>} Each tab's label (with its instance badge), whether it is italic, and whether it is the active one
 */
export async function openTabs(tab) {
  return tab.page.locator("[data-tab]").evaluateAll((elements) =>
    elements.map((element) => {
      const name = element.querySelector("span.font-mono");
      return {
        label: (element.querySelector("button")?.innerText ?? "").replace(/\s+/g, " ").trim(),
        preview: name?.classList.contains("italic") === true,
        active: element.classList.contains("bg-default") && !element.classList.contains("hover:bg-default/60"),
      };
    }),
  );
}

/**
 * The grid's paging footer.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<{ rows: string, range: string, pages: string[], previousDisabled: boolean, nextDisabled: boolean, size: string }>} The row total text, the range text, the page buttons, whether Previous and Next are disabled and the rows per page
 */
export async function pagingFooter(tab) {
  const footer = tab.page.locator("footer", { has: tab.page.getByRole("navigation", { name: "Pagination" }) });
  const nav = footer.getByRole("navigation", { name: "Pagination" });
  const buttons = await nav.getByRole("button").allInnerTexts();
  return {
    rows: (await footer.locator("span").first().innerText().catch(() => "")).trim(),
    range: (await nav.locator("span").first().innerText().catch(() => "")).trim(),
    pages: buttons.map((text) => text.trim()).filter((text) => /^\d+$/.test(text)),
    previousDisabled: await nav.getByRole("button", { name: "Previous page" }).isDisabled().catch(() => false),
    nextDisabled: await nav.getByRole("button", { name: "Next page" }).isDisabled().catch(() => false),
    size: (await footer.getByRole("combobox").innerText().catch(() => "")).trim(),
  };
}

/**
 * Sets the rows per page.
 *
 * @param {Tab} tab The tab
 * @param {number} size 25, 50, 100 or 200
 * @returns {Promise<void>}
 */
export async function pickPageSize(tab, size) {
  const footer = tab.page.locator("footer", { has: tab.page.getByRole("navigation", { name: "Pagination" }) });
  await footer.getByRole("combobox").click();
  await tab.click({ role: "option", name: String(size), exact: true });
}

/**
 * The count the toolbar shows next to the table name.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} Such as `1,250 rows`
 */
export async function toolbarCount(tab) {
  const text = await tab.page.locator("div.border-b", { has: tab.page.getByRole("textbox", { name: "Search rows" }) }).first().locator("span.font-mono").nth(1).innerText().catch(() => "");
  return text.trim();
}

/**
 * Adds a column filter through the Add filter popover.
 *
 * @param {Tab} tab The tab
 * @param {string} column The column
 * @param {"contains" | "is exactly"} mode The mode
 * @param {string} value The value
 * @returns {Promise<void>}
 */
export async function addFilter(tab, column, mode, value) {
  await tab.click({ role: "button", name: "Add filter" });
  const dialog = tab.page.getByRole("dialog", { name: "Add filter" });
  await dialog.getByRole("combobox").nth(0).click();
  await tab.click({ role: "option", name: column, exact: true });
  await dialog.getByRole("combobox").nth(1).click();
  await tab.click({ role: "option", name: mode, exact: true });
  await tab.fill({ role: "textbox", name: "Value" }, value);
  await tab.click({ role: "button", name: "Apply", exact: true });
}

/**
 * The filter chips under the toolbar.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} Each chip as `column mode value`
 */
export async function filterChips(tab) {
  const chips = await tab.page.locator("span.rounded-md.border", { has: tab.page.getByRole("button", { name: /^Remove the filter on/ }) }).allInnerTexts();
  return chips.map((chip) => chip.replace(/\s+/g, " ").trim());
}
