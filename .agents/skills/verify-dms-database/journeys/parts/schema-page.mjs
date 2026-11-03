/**
 * @typedef {import("../../database.mjs").Ctx} Ctx
 * @typedef {import("../../database.mjs").Tab} Tab
 * @typedef {{ name: string, schema: string, rows: string, columns: string, indexes: string, relations: string[], modifiers: string[] }} Listed
 */

export const BAR = { role: "search", name: "Filter the tables" };
const PAGE = "/modules/database/schemas";
const POLL_MS = 250;
const WAIT_MS = 20_000;

/**
 * Opens the Schemas page signed in as the owner, waits until its table answers.
 *
 * @param {Ctx} ctx The journey
 * @param {string} [query] The query string, with its question mark
 * @returns {Promise<Tab>} The tab
 */
export async function openSchemas(ctx, query = "") {
  const tab = await ctx.tab();
  await tab.signIn("admin");
  await tab.goto(`${PAGE}${query}`);
  await settled(tab);
  return tab;
}

/**
 * Waits until the page is hydrated: the first filter chip toggles when clicked.
 *
 * @param {Tab} tab The tab on the Schemas page
 * @returns {Promise<void>}
 */
export async function settled(tab) {
  await tab.page.locator("[data-dms-database-schemas-filter-bar]").waitFor({ state: "visible", timeout: WAIT_MS });
  await tab.page.locator("table tbody tr, [data-empty-state], h2").first().waitFor({ state: "visible", timeout: WAIT_MS });
  await tab.page.waitForTimeout(1500);
}

/**
 * The tables the list shows, in order.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<Listed[]>} The rows
 */
export async function listed(tab) {
  const cells = await tab.page.evaluate(() => [...document.querySelectorAll("table tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((cell) => cell.innerText.trim())));
  return cells
    .filter((row) => row.length >= 8)
    .map((row) => ({
      name: (row[1] ?? "").split(/\s+/)[0] ?? "",
      schema: row[2] ?? "",
      rows: row[3] ?? "",
      columns: row[4] ?? "",
      indexes: row[5] ?? "",
      relations: (row[6] ?? "").split(/\s+/).filter(Boolean),
      modifiers: (row[7] ?? "").split(/\s+/).filter(Boolean),
    }));
}

/**
 * Polls the list until `done` holds for it, and returns the last reading.
 *
 * @param {Tab} tab The tab
 * @param {(rows: Listed[]) => boolean} done Whether the list is the awaited one
 * @returns {Promise<Listed[]>} The last rows read
 */
export async function listUntil(tab, done) {
  const deadline = Date.now() + WAIT_MS;
  let rows = await listed(tab);
  while (!done(rows) && Date.now() < deadline) {
    await tab.page.waitForTimeout(POLL_MS);
    rows = await listed(tab);
  }
  return rows;
}

/**
 * The query parameters of the page's URL.
 *
 * @param {Tab} tab The tab
 * @returns {URLSearchParams} The parameters
 */
export function params(tab) {
  return new URL(tab.page.url()).searchParams;
}

/**
 * Waits until the URL's parameters satisfy `done`, and returns them.
 *
 * @param {Tab} tab The tab
 * @param {(query: URLSearchParams) => boolean} done Whether the URL is the awaited one
 * @returns {Promise<URLSearchParams>} The parameters
 */
export async function paramsUntil(tab, done) {
  const deadline = Date.now() + WAIT_MS;
  while (!done(params(tab)) && Date.now() < deadline) await tab.page.waitForTimeout(POLL_MS);
  return params(tab);
}

/**
 * Picks an option of one of the filter bar's menus.
 *
 * @param {Tab} tab The tab
 * @param {"Schema" | "Instance"} menu The menu
 * @param {string} option The option's name
 * @returns {Promise<void>}
 */
export async function pickFrom(tab, menu, option) {
  await tab.click({ role: "button", name: menu, within: BAR });
  const entry = tab.page.getByRole("option", { name: option, exact: true });
  await entry.first().waitFor({ state: "visible", timeout: WAIT_MS });
  await entry.first().click();
  const closed = await tab.page.getByRole("listbox").first().waitFor({ state: "hidden", timeout: 3000 }).then(() => true, () => false);
  if (!closed) await tab.page.keyboard.press("Escape");
}

/**
 * What the bar's count says, or an empty string when it shows none.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The text
 */
export async function countText(tab) {
  const body = await tab.page.locator("[data-dms-database-schemas-filter-bar]").innerText().catch(() => "");
  return body.match(/\d[\d,]* of \d[\d,]* tables/)?.[0] ?? "";
}
