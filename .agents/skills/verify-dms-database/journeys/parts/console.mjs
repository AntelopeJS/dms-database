import { readFileSync } from "node:fs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */

const EDITOR = { role: "textbox", name: "Query editor (AQL)" };
const SETTLE_MS = 1500;
const HYDRATION_MS = 3000;

/**
 * Opens the Query console as the owner and waits for the editor to hydrate.
 *
 * @param {Ctx} ctx The journey
 * @param {string} [path] The console path, with its query string
 * @returns {Promise<Tab>} The tab on the console
 */
export async function openConsole(ctx, path = "/modules/database/query") {
  const tab = await ctx.tab();
  await tab.signIn("admin");
  await tab.goto(path);
  await ctx.verify("the console opens", [tab.visible({ role: "heading", name: "Query console", level: 1 }, { timeoutMs: 30_000 }), tab.visible(EDITOR)], { critical: true });
  await tab.page.waitForTimeout(HYDRATION_MS);
  return tab;
}

/**
 * @param {Tab} tab The tab
 * @returns {import("playwright-core").Locator} The editor
 */
export function editor(tab) {
  return tab.page.getByRole("textbox", { name: "Query editor (AQL)" });
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The text of the editor
 */
export async function editorText(tab) {
  return (await editor(tab).textContent()) ?? "";
}

/**
 * Types a query into the editor and runs it with Ctrl+Enter or the Run button.
 *
 * @param {Tab} tab The tab on the console
 * @param {string} source The AQL text
 * @param {{ button?: boolean }} [options] Click Run instead of pressing the shortcut
 * @returns {Promise<string>} The page text once the run settled
 */
export async function runSource(tab, source, options = {}) {
  await editor(tab).fill(source);
  if (options.button) await tab.page.getByRole("button", { name: /^Run/ }).click();
  else await editor(tab).press("Control+Enter");
  await tab.page.waitForTimeout(SETTLE_MS);
  return flat(await tab.page.locator("body").innerText());
}

/**
 * @param {string} text Page text
 * @returns {string} The text on one line
 */
export function flat(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The text of the Result region, from its header to the end of the page.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The text from 'Result' on
 */
export async function resultText(tab) {
  const text = flat(await tab.page.locator("body").innerText());
  return text.slice(text.lastIndexOf(" Result ") + 1);
}

/**
 * Chooses a result view (Table, JSON, Chart).
 *
 * @param {Tab} tab The tab
 * @param {string} view The view's name
 */
export async function chooseView(tab, view) {
  await tab.page.getByRole("radio", { name: view, exact: true }).click();
  await tab.page.waitForTimeout(500);
}

/**
 * Clicks Export CSV and reads the downloaded file.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<{ name: string, text: string }>} The file name and its text
 */
export async function exportCsv(tab) {
  const download = tab.page.waitForEvent("download", { timeout: 15_000 });
  await tab.page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  const path = await file.path();
  return { name: file.suggestedFilename(), text: path ? readFileSync(path, "utf8") : "" };
}
