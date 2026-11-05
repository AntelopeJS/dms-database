import { guarded } from "../../guard.mjs";
import { check, show } from "../../database.mjs";
import { openTable, openTabs, settle } from "./browse.mjs";
import { barStatus, cellOf, cellState, openEditor, openReview, recordEdits, reviewLabel, saveStaged, savedNotice, storedRow, typeInto } from "./edit.mjs";
import { queryRow } from "./query-wire.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */

/**
 * @param {Ctx} ctx The journey
 * @param {string} table A table of the shop
 * @param {string} [instance] The instance
 * @returns {Promise<Tab>} A signed-in tab on the table
 */
async function shopTab(ctx, table, instance) {
  const tab = await ctx.tab();
  await tab.signIn("admin");
  await openTable(tab, "shop", table, instance);
  return tab;
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<number>} How many tab-bar dots announce unsaved changes
 */
async function dotCount(tab) {
  return tab.page.locator("[data-tab] span[title$='unsaved changes'], [data-tab] span[title$='unsaved change']").count();
}

/**
 * Reads the saved rows back after a reload and in a fresh tab.
 *
 * @param {Ctx} ctx The journey
 * @param {Tab} tab The tab that saved
 * @returns {Promise<void>}
 */
async function readBack(ctx, tab) {
  await tab.page.reload();
    await tab.visible({ role: "textbox", name: "Search rows" }, { timeoutMs: 60_000 });
    const reloaded = await settle(() => cellState(tab, "eu_sku_lamp", "name"), (state) => state.text === "Reading lamp");
    const fresh = await shopTab(ctx, "products", "eu");
    const freshState = await settle(() => cellState(fresh, "eu_sku_desk", "name"), (state) => state.text === "Sit-stand desk");
    await ctx.verify("read back through a reload and a fresh tab", [
      check("a reload shows the saved name and no struck value", reloaded.text === "Reading lamp" && reloaded.struck === "", reloaded),
      check("a fresh tab shows the saved desk", freshState.text === "Sit-stand desk", freshState),
      check("no staged change is left", (await reviewLabel(tab)) === "" && (await openTabs(tab)).length === 1, await reviewLabel(tab)),
    ]);
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const stagedSave = {
  id: "edits-are-staged-then-reviewed-then-written-one-put-per-row",
  title: "a typed cell is only staged, with the old value struck through, nothing is written until Ctrl S lists every change and Save writes one PUT per row with all its changed fields, and the stored rows are read back through the API, the query console, a reload and a fresh tab",
  entryPoint: "/modules/database/data?schema=shop&table=products&instance=eu",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await shopTab(ctx, "products", "eu");
    await typeInto(tab, "eu_sku_lamp", "name", "Reading lamp");
    await typeInto(tab, "eu_sku_lamp", "price", "55.5");
    await typeInto(tab, "eu_sku_desk", "name", "Sit-stand desk");
    const name = await cellState(tab, "eu_sku_lamp", "name");
    const price = await cellState(tab, "eu_sku_lamp", "price");
    const label = await reviewLabel(tab);
    const status = await barStatus(tab);
    const dots = await dotCount(tab);
    const dotTitle = await tab.page.locator("[data-tab] span.rounded-full").first().getAttribute("title");
    const lamp = await storedRow(ctx, "products", "eu_sku_lamp", "eu");
    const desk = await storedRow(ctx, "products", "eu_sku_desk", "eu");
    await ctx.verify("typed cells are staged", [
      check("the lamp's name shows Desk lamp struck through, then Reading lamp", name.struck === "Desk lamp" && name.text === "Desk lamp Reading lamp" && name.title === "Unsaved · was Desk lamp", name),
      check("a number cell is staged as a number: 48 struck, 55.5", price.struck === "48" && price.text === "48 55.5", price),
      check("the bar counts the three changes on its Review and save button", label === "Review and save 3 changes", label),
      check("the bar names the changed fields", /^Unsaved changes · name, price$/.test(status) || /^Unsaved changes · (name, price|price, name)$/.test(status), status),
      check("the tab carries a dot titled 3 unsaved changes", dots === 1 && dotTitle === "3 unsaved changes", [dots, dotTitle]),
      check("nothing is written: the API still holds the old values", lamp.name === "Desk lamp" && lamp.price === 48 && desk.name === "Standing desk", [lamp.name, lamp.price, desk.name]),
    ]);
    const review = await openReview(tab);
    await tab.click({ role: "button", name: "Keep editing" });
    await tab.visible({ role: "dialog", name: /^Save/ }, { hidden: true });
    const kept = await reviewLabel(tab);
    const stillOld = await storedRow(ctx, "products", "eu_sku_lamp", "eu");
    await ctx.verify("the review lists every change", [
      check("the title and the scope", /Save 3 changes to products\?/.test(review) && /They are written to shop\.products @eu\./.test(review), review),
      check("each change reads field, row, before → after", /name eu_sku_lamp Desk lamp → Reading lamp/.test(review) && /price eu_sku_lamp 48 → 55\.5/.test(review) && /name eu_sku_desk Standing desk → Sit-stand desk/.test(review), review),
      check("Keep editing writes nothing and keeps the three changes", kept === "Review and save 3 changes" && stillOld.name === "Desk lamp", [kept, stillOld.name]),
    ]);
    const writes = await recordEdits(tab, async () => {
      await saveStaged(tab);
      await settle(() => savedNotice(tab), (content) => /saved/.test(content));
    });
    const notice = await savedNotice(tab);
    const savedLamp = await storedRow(ctx, "products", "eu_sku_lamp", "eu");
    const savedDesk = await storedRow(ctx, "products", "eu_sku_desk", "eu");
    const other = await storedRow(ctx, "products", "eu_sku_monitor", "eu");
    const us = await storedRow(ctx, "products", "us_sku_lamp", "us");
    const fallback = await storedRow(ctx, "products", "sku_lamp");
    const byQuery = await queryRow(ctx, "shop", "products", "eu_sku_lamp", "eu");
    const ordered = [...writes].sort((left, right) => left.id.localeCompare(right.id));
    await ctx.verify("the save", [
      check("two PUTs, one per row: the lamp with both fields, the desk with its one", show(ordered) === '[{"id":"eu_sku_desk","body":{"name":"Sit-stand desk"}},{"id":"eu_sku_lamp","body":{"name":"Reading lamp","price":55.5}}]', writes),
      check("the bar announces 3 changes saved, with Undo", notice === "3 changes saved to shop.products @eu" && (await tab.visible({ role: "button", name: "Undo" })).pass, notice),
      check("the API holds the new values, the price a number", savedLamp.name === "Reading lamp" && savedLamp.price === 55.5 && savedDesk.name === "Sit-stand desk", [savedLamp.name, savedLamp.price, savedDesk.name]),
      check("the other fields and rows are untouched", show(savedLamp.tags) === '["office","bestseller"]' && other.name === "27-inch monitor", [savedLamp.tags, other.name]),
      check("the same row of the other instances is untouched", us.name === "Desk lamp" && fallback.name === "Desk lamp", [us.name, fallback.name]),
      check("the query console reads the same row", byQuery?.name === "Reading lamp" && byQuery.price === 55.5, byQuery),
    ]);
    await readBack(ctx, tab);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const invalidDrafts = {
  id: "invalid-drafts-are-refused-esc-cancels-and-a-click-away-decides",
  title: "an invalid number, boolean or date keeps the editor open with its message and Esc to cancel, Esc leaves the cell as it was, an unchanged value stages nothing, a valid value is staged, and a click elsewhere commits a valid draft and drops an invalid one",
  entryPoint: "/modules/database/data cell editor",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await shopTab(ctx, "orders", "eu");
    const message = async () => (await tab.page.locator("td span.bg-error").first().innerText().catch(() => "")).trim();
    await typeInto(tab, "eu_ord_10400", "total", "abc");
    const number = await settle(message, (content) => content !== "");
    const editorStays = await tab.visible({ role: "textbox", name: "Value of total" });
    await tab.press("Escape");
    const afterEsc = await cellState(tab, "eu_ord_10400", "total");
    await typeInto(tab, "eu_ord_10400", "total", "");
    const empty = await settle(message, (content) => content !== "");
    await tab.press("Escape");
    await typeInto(tab, "eu_ord_10400", "total", "Infinity");
    const infinite = await settle(message, (content) => content !== "");
    await tab.press("Escape");
    await typeInto(tab, "eu_ord_10400", "created_at", "yesterday");
    const date = await settle(message, (content) => content !== "");
    await tab.press("Escape");
    await typeInto(tab, "eu_ord_10400", "created_at", "2026-02-30");
    const impossible = await settle(message, (content) => content !== "");
    await tab.press("Escape");
    await ctx.verify("invalid drafts", [
      check("a text in a number cell: the message and the editor stay", number === "Expected a number, e.g. 860.50 · Esc to cancel" && editorStays.pass, number),
      check("Esc leaves the cell as it was, nothing staged", afterEsc.text === "50" && afterEsc.struck === "" && (await reviewLabel(tab)) === "", [afterEsc, await reviewLabel(tab)]),
      check("an empty draft is no number", empty === "Expected a number, e.g. 860.50 · Esc to cancel", empty),
      check("Infinity is no number", infinite === "Expected a number, e.g. 860.50 · Esc to cancel", infinite),
      check("a text in a date cell: the date message", date === "Expected a date, e.g. 2026-10-09 or 2026-10-09T14:30Z · Esc to cancel", date),
      check("a day that does not exist (2026-02-30) is refused", impossible === "Expected a date, e.g. 2026-10-09 or 2026-10-09T14:30Z · Esc to cancel", impossible),
    ]);
    await typeInto(tab, "eu_ord_10400", "total", "50.0");
    const same = await cellState(tab, "eu_ord_10400", "total");
    await typeInto(tab, "eu_ord_10400", "total", " 860.50 ");
    const staged = await cellState(tab, "eu_ord_10400", "total");
    await typeInto(tab, "eu_ord_10400", "created_at", "2026-10-09");
    const dated = await cellState(tab, "eu_ord_10400", "created_at");
    await typeInto(tab, "eu_ord_10400", "created_at", "2026-10-09T14:30Z");
    const timed = await cellState(tab, "eu_ord_10400", "created_at");
    await ctx.verify("valid drafts", [
      check("50.0 over 50 is no change", same.struck === "" && same.text === "50", same),
      check("a padded 860.50 is staged as the number 860.5", staged.struck === "50" && staged.text === "50 860.5", staged),
      check("a date is staged as an ISO instant", dated.text.endsWith("2026-10-09T00:00:00.000Z"), dated),
      check("a date with a time and a zone keeps its time", timed.text.endsWith("2026-10-09T14:30:00.000Z"), timed),
      check("the bar counts the two staged cells", (await reviewLabel(tab)) === "Review and save 2 changes", await reviewLabel(tab)),
    ]);
    await tab.click({ role: "button", name: "Discard", exact: true });
    await openEditor(tab, "eu_ord_10401", "total");
    await tab.fill({ role: "textbox", name: "Value of total" }, "abc");
    await tab.page.getByRole("heading", { name: "Data browser", level: 1 }).click();
    const dropped = await cellState(tab, "eu_ord_10401", "total");
    await openEditor(tab, "eu_ord_10401", "total");
    await tab.fill({ role: "textbox", name: "Value of total" }, "777");
    await tab.page.getByRole("heading", { name: "Data browser", level: 1 }).click();
    const committed = await settle(() => cellState(tab, "eu_ord_10401", "total"), (state) => state.text.endsWith("777"));
    await ctx.verify("a click elsewhere", [
      check("an invalid draft is dropped", dropped.struck === "" && !dropped.text.includes("abc"), dropped),
      check("a valid draft is committed", committed.text.endsWith("777") && committed.struck !== "", committed),
    ]);
    await tab.click({ role: "button", name: "Discard", exact: true });
    await tab.page.goto(`${tab.page.url().split("/modules")[0]}/modules/database/data?schema=shop&table=customers&instance=eu`);
    await tab.visible({ role: "textbox", name: "Search rows" }, { timeoutMs: 60_000 });
    const vip = await openVipBoolean(tab);
    await ctx.verify("a boolean cell", vip);
  },
};

/**
 * Drives the boolean cell of the first customers: a select that stages at once, and a typed draft over a null cell.
 *
 * @param {Tab} tab The tab on eu's customers
 * @returns {Promise<import("../../database.mjs").Check[]>} The checks
 */
async function openVipBoolean(tab) {
  const cell = await cellOf(tab, "eu_cus_001", "vip");
  await cell.dblclick();
  const select = tab.page.getByRole("combobox", { name: "Value of vip" });
  await select.waitFor({ state: "visible" });
  const options = await select.allInnerTexts();
  await tab.select({ role: "combobox", name: "Value of vip" }, "true");
  const staged = await settle(() => cellState(tab, "eu_cus_001", "vip"), (state) => state.struck !== "");
  await tab.click({ role: "button", name: "Discard", exact: true });
  await tab.page.getByRole("cell", { name: "eu_cus_002", exact: true }).click();
  await tab.press(" ");
  await tab.page.getByRole("dialog").getByRole("button", { name: "Set to null" }).nth(3).waitFor({ state: "visible" });
  await tab.page.locator('[data-field-row="vip"]').getByRole("button", { name: "Set to null" }).click();
  await tab.click({ role: "button", name: "Close" });
  await tab.visible({ role: "dialog" }, { hidden: true });
  await typeInto(tab, "eu_cus_002", "vip", "maybe");
  const message = await settle(async () => (await tab.page.locator("td span.bg-error").first().innerText().catch(() => "")).trim(), (content) => content !== "");
  await tab.press("Escape");
  await typeInto(tab, "eu_cus_002", "vip", "TRUE");
  const typed = await settle(() => cellState(tab, "eu_cus_002", "vip"), (state) => state.text.endsWith("true"));
  return [
    check("a boolean cell offers true and false", /true/.test(options.join()) && /false/.test(options.join()), options),
    check("choosing true over false stages it at once", staged.struck === "false" && staged.text === "false true", staged),
    check("over an emptied boolean cell, maybe is refused", message === "Expected true or false · Esc to cancel", message),
    check("TRUE is accepted whatever its case, as the boolean true over the cell's stored false", typed.text === "false true" && typed.struck === "false", typed),
  ];
}

export const cellJourneys = guarded([stagedSave, invalidDrafts]);
