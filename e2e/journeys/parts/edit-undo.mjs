import { check, show } from "../../database.mjs";
import { openTable, settle } from "./browse.mjs";
import { barStatus, cellState, recordEdits, reviewLabel, savedNotice, saveStaged, storedRow, typeInto } from "./edit.mjs";
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

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const undoRestores = {
  id: "undo-writes-the-previous-values-back-within-the-window",
  title: "Undo after a save writes every previous value back, an emptied cell goes back to null and a nested value to its object, as one PUT per row, announces the undone changes for a few seconds, and a new edit ends the offer",
  entryPoint: "/modules/database/data save bar",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await shopTab(ctx, "orders", "eu");
    const before = await storedRow(ctx, "orders", "eu_ord_10401", "eu");
    await typeInto(tab, "eu_ord_10401", "coupon_id", "SAVE5");
    await typeInto(tab, "eu_ord_10401", "total", "1");
    await typeInto(tab, "eu_ord_10401", "status", "null");
    await saveStaged(tab);
    const saved = await storedRow(ctx, "orders", "eu_ord_10401", "eu");
    let seenAt = 0;
    let goneAt = 0;
    const writes = await recordEdits(tab, async () => {
      await tab.click({ role: "button", name: "Undo" });
      for (let attempt = 0; attempt < 400 && seenAt === 0; attempt += 1) {
        if (/undone/.test(await barStatus(tab))) seenAt = Date.now();
        else await tab.page.waitForTimeout(50);
      }
      for (let attempt = 0; attempt < 400 && goneAt === 0; attempt += 1) {
        if ((await barStatus(tab)) === "") goneAt = Date.now();
        else await tab.page.waitForTimeout(50);
      }
    });
    const notice = "3 changes undone";
    const restored = await storedRow(ctx, "orders", "eu_ord_10401", "eu");
    const byQuery = await queryRow(ctx, "shop", "orders", "eu_ord_10401", "eu");
    const shown = await cellState(tab, "eu_ord_10401", "coupon_id");
    await ctx.verify("undo", [
      check("the save wrote the three values", saved.coupon_id === "SAVE5" && saved.total === 1 && saved.status === null, [saved.coupon_id, saved.total, saved.status]),
      check("the row had a null coupon before", before.coupon_id === null, before.coupon_id),
      check("one PUT writes the previous values back, null for the empty one", show(writes) === `[{"id":"eu_ord_10401","body":{"coupon_id":null,"total":${JSON.stringify(before.total)},"status":${JSON.stringify(before.status)}}}]`, writes),
      check("the bar says 3 changes undone", seenAt > 0, notice),
      check("the API holds the old values again, the empty coupon null", restored.coupon_id === null && restored.total === before.total && restored.status === before.status, [restored.coupon_id, restored.total, restored.status]),
      check("the query console reads the same restored row", byQuery?.coupon_id === null && byQuery.total === before.total, byQuery),
      check("the grid shows the restored values, nothing struck", shown.text === "null" && shown.struck === "", shown),
      check("the undone notice stays about three seconds, then goes away by itself", seenAt > 0 && goneAt - seenAt >= 2_600 && goneAt - seenAt <= 4_200, goneAt - seenAt),
    ]);
    await typeInto(tab, "eu_ord_10402", "channel", "kiosk");
    await saveStaged(tab);
    const offered = await tab.visible({ role: "button", name: "Undo" });
    await typeInto(tab, "eu_ord_10402", "currency", "GBP");
    const ended = await tab.visible({ role: "button", name: "Undo" }, { hidden: true, timeoutMs: 5_000 });
    const pending = await reviewLabel(tab);
    await ctx.verify("a new edit ends the offer", [
      check("the save offered Undo", offered.pass, offered.detail),
      check("a new staged change replaces the offer by the bar of staged changes", ended.pass && pending === "Review and save 1 change", [ended.detail, pending]),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const undoExpires = {
  id: "undo-is-offered-for-ten-seconds-then-the-values-stay",
  title: "after a save Undo stays for ten seconds, measured from the click on Save, and when it is gone the saved values stay and the FAQ's advice applies: nothing can write them back",
  entryPoint: "/modules/database/data save bar",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await shopTab(ctx, "products", "eu");
    await typeInto(tab, "eu_sku_dock", "name", "Hub");
    const review = tab.page.getByRole("button", { name: /^Review and save/ }).first();
    await review.click();
    await tab.visible({ role: "dialog", name: /^Save/ });
    const clickedAt = Date.now();
    await tab.click({ role: "button", name: /^Save \d+ changes?$/ });
    await tab.visible({ role: "button", name: "Undo" });
    const shownAt = Date.now() - clickedAt;
    let goneAt = 0;
    for (let attempt = 0; attempt < 120 && goneAt === 0; attempt += 1) {
      const count = await tab.page.getByRole("button", { name: "Undo" }).count();
      if (count === 0) goneAt = Date.now() - clickedAt;
      else await tab.page.waitForTimeout(100);
    }
    const stored = await storedRow(ctx, "products", "eu_sku_dock", "eu");
    const status = await barStatus(tab);
    await ctx.verify("the window", [
      check("Undo appears with the save", shownAt < 5_000, shownAt),
      check("Undo is gone between 9.9 and 11.5 seconds after the click on Save", goneAt >= 9_900 && goneAt <= 11_500, goneAt),
      check("the saved name stays", stored.name === "Hub", stored.name),
      check("no notice is left in the bar", status === "", status),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const undoFails = {
  id: "an-undo-whose-write-fails-keeps-the-saved-values-and-offers-undo-again",
  title: "when the write of an Undo fails the saved values stay stored, a toast says the changes could not be undone, Undo is offered again for the rows left, and the retry writes the previous values back",
  entryPoint: "PUT /api/database/browse/edit answering 500 after a save",
  async run(ctx) {
    const tab = await shopTab(ctx, "products", "eu");
    const before = await storedRow(ctx, "products", "eu_sku_lamp", "eu");
    const chairBefore = await storedRow(ctx, "products", "eu_sku_chair", "eu");
    await typeInto(tab, "eu_sku_lamp", "name", "Reading lamp");
    await typeInto(tab, "eu_sku_chair", "name", "Armchair");
    let failing = false;
    let refused = 0;
    await tab.page.route("**/api/database/browse/edit**", async (route) => {
      if (!failing) {
        await route.continue();
        return;
      }
      refused += 1;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Disk full" }) });
    });
    await saveStaged(tab);
    const saved = await storedRow(ctx, "products", "eu_sku_lamp", "eu");
    failing = true;
    await tab.click({ role: "button", name: "Undo" });
    const toast = await settle(() => tab.page.locator("body").innerText(), (content) => /Couldn.t undo the changes/.test(content));
    const lamp = await storedRow(ctx, "products", "eu_sku_lamp", "eu");
    const chair = await storedRow(ctx, "products", "eu_sku_chair", "eu");
    const offered = await tab.visible({ role: "button", name: "Undo" });
    const lampCell = await cellState(tab, "eu_sku_lamp", "name");
    await ctx.verify("the undo is refused", [
      check("the save wrote both names", saved.name === "Reading lamp", saved.name),
      check("the toast says the changes couldn't be undone", /Couldn.t undo the changes/.test(toast), toast.replace(/\s+/g, " ").slice(-300)),
      check("the run stopped at the first failing write", refused === 1, refused),
      check("the saved names stay stored", lamp.name === "Reading lamp" && chair.name === "Armchair", [lamp.name, chair.name]),
      check("the grid shows the saved name, nothing struck", lampCell.text === "Reading lamp" && lampCell.struck === "", lampCell),
      check("Undo is offered again", offered.pass, offered.detail),
    ]);
    failing = false;
    await tab.click({ role: "button", name: "Undo" });
    const retried = await savedNotice(tab);
    const lampBack = await storedRow(ctx, "products", "eu_sku_lamp", "eu");
    const chairBack = await storedRow(ctx, "products", "eu_sku_chair", "eu");
    await ctx.verify("the retry", [
      check("the bar says 2 changes undone", /2 changes undone/.test(retried), retried),
      check("both previous names are stored again", lampBack.name === before.name && chairBack.name === chairBefore.name, [lampBack.name, chairBack.name]),
    ]);
  },
};

export const undoJourneys = [undoRestores, undoExpires, undoFails];

