import { check, isRow, list, pick, text } from "../../database.mjs";
import { browse, columnNames, settle } from "./browse.mjs";

/**
 * @typedef {import("../../database.mjs").Ctx} Ctx
 * @typedef {import("../../database.mjs").Tab} Tab
 * @typedef {import("../../database.mjs").Row} Row
 * @typedef {import("playwright-core").Locator} Locator
 */

/**
 * The grid cell of a row and a column.
 *
 * @param {Tab} tab The tab
 * @param {string} rowId The row's id cell text
 * @param {string} column The column name
 * @returns {Promise<Locator>} The cell
 */
export async function cellOf(tab, rowId, column) {
  const names = await columnNames(tab);
  const row = tab.page.locator(`tbody tr:has(span:text-is("${rowId}"))`).first();
  return row.locator("td").nth(names.indexOf(column) + 1);
}

/**
 * Edits a cell the way a user does: double-click, type, Enter.
 *
 * @param {Tab} tab The tab
 * @param {string} rowId The row
 * @param {string} column The column
 * @param {string} value What to type
 * @returns {Promise<void>}
 */
export async function typeInto(tab, rowId, column, value) {
  const cell = await cellOf(tab, rowId, column);
  await cell.dblclick();
  await tab.fill({ role: "textbox", name: `Value of ${column}` }, value);
  await tab.press("Enter");
}

/**
 * Starts the editor of a cell with the keyboard: click to focus, Enter to edit.
 *
 * @param {Tab} tab The tab
 * @param {string} rowId The row
 * @param {string} column The column
 * @returns {Promise<void>}
 */
export async function openEditor(tab, rowId, column) {
  const cell = await cellOf(tab, rowId, column);
  await cell.click();
  await tab.press("Enter");
}

/**
 * What the cell shows: its text with the struck-through old value first when it is staged.
 *
 * @param {Tab} tab The tab
 * @param {string} rowId The row
 * @param {string} column The column
 * @returns {Promise<{ text: string, struck: string, title: string }>} The cell text, the struck old value and the hover title
 */
export async function cellState(tab, rowId, column) {
  const cell = await cellOf(tab, rowId, column);
  return {
    text: (await cell.innerText()).replace(/\s+/g, " ").trim(),
    struck: (await cell.locator("s").first().innerText().catch(() => "")).trim(),
    title: (await cell.getAttribute("title")) ?? "",
  };
}

/**
 * The label of the review button of the save bar.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} Such as `Review and save 2 changes`, empty when there is no bar
 */
export async function reviewLabel(tab) {
  return (await tab.page.getByRole("button", { name: /^Review and save/ }).first().innerText().catch(() => "")).trim();
}

/**
 * The text of the save bar's status line.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} Such as `Unsaved changes · name`
 */
export async function barStatus(tab) {
  return (await tab.page.getByRole("status").first().innerText().catch(() => "")).replace(/\s+/g, " ").replace(/ Undo$/, "").trim();
}

/**
 * Opens the review with Ctrl S and returns its text.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The dialog's text on one line
 */
export async function openReview(tab) {
  await tab.press("Control+s");
  await tab.visible({ role: "dialog", name: /^Save \d+ changes? to / });
  return (await tab.page.getByRole("dialog").innerText()).replace(/\s+/g, " ").trim();
}

/**
 * Opens the review and confirms it.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The review's text
 */
export async function saveStaged(tab) {
  const review = await openReview(tab);
  await tab.click({ role: "button", name: /^Save \d+ changes?$/ });
  await tab.visible({ role: "dialog", name: /^Save \d+ changes? to / }, { hidden: true, timeoutMs: 30_000 });
  return review;
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The text of the status line after a save
 */
export async function savedNotice(tab) {
  return settle(() => barStatus(tab), (content) => /changes? (saved|undone)/.test(content));
}

/**
 * The stored row of the shop, read through browse/get.
 *
 * @param {Ctx} ctx The journey
 * @param {string} table The table
 * @param {string} id The row
 * @param {string} [instance] The instance, none for the default one
 * @returns {Promise<Row>} The stored row, an empty object when it does not exist
 */
export async function storedRow(ctx, table, id, instance) {
  const answer = await browse(ctx, `read ${table} ${id}`, "get", `shop.${table}`, instance ? { filter_instance: `is:${instance}`, id } : { id });
  return answer.status === 200 && isRow(answer.body) ? { ...answer.body } : {};
}

/**
 * The PUT requests to the edit route a tab makes while `body` runs.
 *
 * @param {Tab} tab The tab
 * @param {() => Promise<void>} body What the user does
 * @returns {Promise<{ id: string, body: unknown }[]>} The id each write names and the JSON body it sent
 */
export async function recordEdits(tab, body) {
  /** @type {{ id: string, body: unknown }[]} */
  const writes = [];
  tab.page.on("request", (request) => {
    if (request.method() !== "PUT" || !request.url().includes("/api/database/browse/edit")) return;
    const posted = request.postData();
    writes.push({ id: new URL(request.url()).searchParams.get("id") ?? "", body: posted ? JSON.parse(posted) : null });
  });
  await body();
  return writes;
}

export { check, list, pick, text };
