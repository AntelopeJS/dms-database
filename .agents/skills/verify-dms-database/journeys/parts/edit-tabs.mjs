import { guarded } from "../../guard.mjs";
import { check } from "../../database.mjs";
import { DATA_PAGE, openTable, openTabs, settle } from "./browse.mjs";
import { cellState, reviewLabel, storedRow, typeInto } from "./edit.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The text of the open dialog on one line, empty when none is open
 */
async function dialogText(tab) {
  return (await tab.page.getByRole("dialog").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const discardAndClose = {
  id: "discard-and-closing-a-tab-with-staged-changes-ask-first",
  title: "Discard drops the staged changes, a tab with staged changes is kept as a regular tab and closing it asks to Discard and close or Keep editing with the number of changes, switching tabs keeps them, and leaving the page asks too",
  entryPoint: "/modules/database/data tab bar and save bar",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await ctx.tab();
    await tab.signIn("admin");
    await tab.goto(DATA_PAGE);
    await tab.visible({ role: "textbox", name: "Find a table" }, { timeoutMs: 60_000 });
    await tab.click({ role: "button", name: "Schema", exact: true });
    await tab.click({ role: "option", name: "shop", exact: true });
    await tab.click({ role: "button", name: "Instance", exact: true });
    await tab.click({ role: "option", name: "eu", exact: true });
    await tab.page.locator("aside nav button").filter({ hasText: /^products/ }).click();
    await settle(() => openTabs(tab), (tabs) => tabs.length === 1 && tabs[0]?.preview === true);
    await typeInto(tab, "eu_sku_lamp", "name", "Reading lamp");
    await typeInto(tab, "eu_sku_lamp", "price", "60");
    const pinned = await settle(() => openTabs(tab), (tabs) => tabs[0]?.preview === false);
    await tab.page.locator("aside nav button").filter({ hasText: /^orders/ }).click();
    const beside = await settle(() => openTabs(tab), (tabs) => tabs.length === 2);
    await tab.page.locator("[data-tab]").first().locator("button").first().click();
    await tab.visible({ role: "textbox", name: "Search rows" });
    const stillStaged = await settle(() => reviewLabel(tab), (content) => content === "Review and save 2 changes");
    await ctx.verify("a tab with staged changes", [
      check("editing a cell keeps a preview tab: it is no longer italic", pinned[0]?.preview === false, pinned),
      check("the next table opens beside it instead of replacing it", beside.length === 2 && beside[0]?.label === "products @eu", beside),
      check("coming back to the tab shows the two changes still staged", stillStaged === "Review and save 2 changes", stillStaged),
    ]);
    await tab.page.locator("[data-tab]").first().locator("button[aria-label='Close tab']").click();
    const ask = await settle(() => dialogText(tab), (content) => content !== "");
    await tab.click({ role: "button", name: "Keep editing" });
    const kept = await openTabs(tab);
    await tab.page.locator("[data-tab]").first().locator("button[aria-label='Close tab']").click();
    await tab.click({ role: "button", name: "Discard and close" });
    const closed = await settle(() => openTabs(tab), (tabs) => tabs.length === 1);
    const lamp = await storedRow(ctx, "products", "eu_sku_lamp", "eu");
    await ctx.verify("closing", [
      check("the dialog names the table and the count of staged changes", /Close products with unsaved changes\?/.test(ask) && /Its 2 staged changes will be lost\./.test(ask), ask),
      check("Keep editing keeps both tabs", kept.length === 2, kept),
      check("Discard and close closes the tab", closed.length === 1 && closed[0]?.label === "orders @eu", closed),
      check("nothing was written", lamp.name === "Desk lamp" && lamp.price === 48, [lamp.name, lamp.price]),
    ]);
    await openTable(tab, "shop", "products", "eu");
    const reopened = await cellState(tab, "eu_sku_lamp", "name");
    await typeInto(tab, "eu_sku_lamp", "name", "One change");
    await tab.page.locator("[data-tab]").filter({ hasText: "products" }).locator("button[aria-label='Close tab']").click();
    const single = await settle(() => dialogText(tab), (content) => content !== "");
    await tab.click({ role: "button", name: "Keep editing" });
    await tab.click({ role: "button", name: "Discard", exact: true });
    const discarded = await cellState(tab, "eu_sku_lamp", "name");
    const bar = await reviewLabel(tab);
    await ctx.verify("one change, and Discard", [
      check("reopening the table shows no staged change", reopened.struck === "" && reopened.text === "Desk lamp", reopened),
      check("one change reads 'Its staged change will be lost.'", /Its staged change will be lost\./.test(single), single),
      check("Discard puts the old value back and empties the bar", discarded.struck === "" && discarded.text === "Desk lamp" && bar === "", [discarded, bar]),
    ]);
    await typeInto(tab, "eu_sku_lamp", "name", "Leaving");
    await tab.page.getByRole("link", { name: "Overview" }).first().click();
    const leaving = await settle(() => dialogText(tab), (content) => content !== "");
    await tab.click({ role: "button", name: "Keep editing" });
    const stays = new URL(tab.page.url()).pathname;
    await tab.page.getByRole("link", { name: "Overview" }).first().click();
    await tab.click({ role: "button", name: "Discard changes" });
    const left = await tab.at(/\/modules\/database\/overview$/);
    const lamp2 = await storedRow(ctx, "products", "eu_sku_lamp", "eu");
    await ctx.verify("leaving the page", [
      check("the leave guard asks before leaving with a staged change", /Discard unsaved changes\?/.test(leaving) && /You’ll lose your changes if you leave without saving\./.test(leaving), leaving),
      check("Keep editing stays on the data browser", stays === "/modules/database/data", stays),
      check("Discard changes leaves, and writes nothing", left.pass && lamp2.name === "Desk lamp", [left.detail, lamp2.name]),
    ]);
  },
};

export const tabJourneys = guarded([discardAndClose]);
