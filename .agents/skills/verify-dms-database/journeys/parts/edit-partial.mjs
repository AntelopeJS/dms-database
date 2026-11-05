import { guarded } from "../../guard.mjs";
import { check } from "../../database.mjs";
import { openTable, columnValues, settle } from "./browse.mjs";
import { barStatus, cellState, openReview, reviewLabel, storedRow, typeInto } from "./edit.mjs";
import { queryDelete } from "./query-wire.mjs";

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
 * @returns {Promise<string>} The open dialog's text on one line
 */
async function dialogText(tab) {
  return (await tab.page.getByRole("dialog").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const rowGone = {
  id: "a-row-deleted-meanwhile-drops-its-changes-and-the-rest-is-saved",
  title: "when a staged row no longer exists the save writes the other rows, says the row's changes were dropped with how many changes were saved, reads the page again, and an Undo of a row deleted since says it no longer exists while the other rows are restored",
  entryPoint: "PUT /api/database/browse/edit answering 404",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await shopTab(ctx, "products", "eu");
    await typeInto(tab, "eu_sku_lamp", "name", "Reading lamp");
    await typeInto(tab, "eu_sku_desk", "name", "Sit-stand desk");
    const deleted = await queryDelete(ctx, "shop", "products", "eu_sku_desk", "eu");
    await openReview(tab);
    await tab.click({ role: "button", name: /^Save \d+ changes?$/ });
    const message = await settle(() => dialogText(tab), (content) => /no longer exists/.test(content));
    const lamp = await storedRow(ctx, "products", "eu_sku_lamp", "eu");
    const desk = await storedRow(ctx, "products", "eu_sku_desk", "eu");
    await tab.press("Escape");
    const names = await settle(() => columnValues(tab, "name"), (values) => values.length === 5);
    const bar = await reviewLabel(tab);
    await ctx.verify("a row deleted before the save", [
      check("the delete went through", deleted.status === 200, deleted.status),
      check("the dialog says 1 of 2 changes saved and that the row's changes were dropped", /1 of 2 changes saved/.test(message) && /1 row no longer exists: its changes were dropped\./.test(message), message),
      check("the lamp was written, the deleted desk was not recreated", lamp.name === "Reading lamp" && Object.keys(desk).length === 0, [lamp.name, desk]),
      check("the page was read again: five rows, the lamp renamed and the desk gone", names.length === 5 && names.includes("Reading lamp") && !names.includes("Standing desk"), names),
      check("no staged change is left", bar === "", bar),
    ]);
    await typeInto(tab, "eu_sku_chair", "name", "Armchair");
    await typeInto(tab, "eu_sku_dock", "name", "Hub");
    await openReview(tab);
    await tab.click({ role: "button", name: /^Save \d+ changes?$/ });
    await settle(() => barStatus(tab), (content) => /saved/.test(content));
    await queryDelete(ctx, "shop", "products", "eu_sku_dock", "eu");
    await tab.click({ role: "button", name: "Undo" });
    const toast = await settle(() => tab.page.locator("body").innerText(), (content) => /couldn.t be undone/.test(content));
    const chair = await storedRow(ctx, "products", "eu_sku_chair", "eu");
    await ctx.verify("an undo after a delete", [
      check("the toast says 1 change couldn't be undone and 1 row no longer exists", /1 change couldn.t be undone/.test(toast) && /1 row no longer exists\./.test(toast), toast.replace(/\s+/g, " ").slice(-300)),
      check("the other row is restored", chair.name === "Task chair", chair.name),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const partialWrites = {
  id: "a-failed-write-stops-the-save-and-the-rows-left-stay-staged",
  title: "when a write fails the rows before it are saved and announced, the failing row and the next ones stay staged with the error, nothing written at all is an error that keeps every change, and saving again writes the rest",
  entryPoint: "PUT /api/database/browse/edit answering 500",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await shopTab(ctx, "products", "eu");
    await typeInto(tab, "eu_sku_lamp", "name", "Reading lamp");
    await typeInto(tab, "eu_sku_chair", "name", "Armchair");
    await typeInto(tab, "eu_sku_dock", "name", "Hub");
    await tab.page.route("**/api/database/browse/edit**", async (route) => {
      if (route.request().url().includes("id=eu_sku_chair")) await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Disk full" }) });
      else await route.continue();
    });
    await openReview(tab);
    await tab.click({ role: "button", name: /^Save \d+ changes?$/ });
    const partial = await settle(() => dialogText(tab), (content) => /1 of 3 changes saved/.test(content));
    const lamp = await storedRow(ctx, "products", "eu_sku_lamp", "eu");
    const chair = await storedRow(ctx, "products", "eu_sku_chair", "eu");
    const dock = await storedRow(ctx, "products", "eu_sku_dock", "eu");
    await tab.press("Escape");
    const left = await reviewLabel(tab);
    const lampCell = await cellState(tab, "eu_sku_lamp", "name");
    const chairCell = await cellState(tab, "eu_sku_chair", "name");
    await ctx.verify("the save stops at the failing row", [
      check("the dialog says 1 of 3 changes saved and that 2 changes stay staged with the error", /1 of 3 changes saved/.test(partial) && /2 changes weren.t written and stay staged/.test(partial), partial),
      check("the first row was written, the failing row and the one after it were not", lamp.name === "Reading lamp" && chair.name === "Task chair" && dock.name === "USB-C dock", [lamp.name, chair.name, dock.name]),
      check("two changes stay staged, on the rows left", left === "Review and save 2 changes" && chairCell.struck === "Task chair" && lampCell.struck === "", [left, chairCell, lampCell]),
    ]);
    await tab.page.unroute("**/api/database/browse/edit**");
    await openReview(tab);
    await tab.click({ role: "button", name: /^Save \d+ changes?$/ });
    await tab.visible({ role: "dialog", name: /^Save/ }, { hidden: true, timeoutMs: 30_000 });
    const retried = await storedRow(ctx, "products", "eu_sku_chair", "eu");
    const retriedDock = await storedRow(ctx, "products", "eu_sku_dock", "eu");
    await ctx.verify("saving again", [check("the rest is written", retried.name === "Armchair" && retriedDock.name === "Hub" && (await reviewLabel(tab)) === "", [retried.name, retriedDock.name])]);
    await typeInto(tab, "eu_sku_monitor", "name", "Screen");
    await tab.page.route("**/api/database/browse/edit**", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Disk full" }) });
    });
    await openReview(tab);
    await tab.click({ role: "button", name: /^Save \d+ changes?$/ });
    await tab.page.waitForTimeout(2_000);
    const refused = await dialogText(tab);
    const monitor = await storedRow(ctx, "products", "eu_sku_monitor", "eu");
    await tab.page.unroute("**/api/database/browse/edit**");
    await tab.click({ role: "button", name: "Keep editing" });
    await ctx.verify("nothing written", [
      check("the dialog stays open for a retry, and nothing was written", /Save 1 change to products\?/.test(refused) && monitor.name === "27-inch monitor", [refused, monitor.name]),
      check("the change is still staged", (await reviewLabel(tab)) === "Review and save 1 change", await reviewLabel(tab)),
    ]);
  },
};

export const partialJourneys = guarded([rowGone, partialWrites]);
