import { check } from "../../database.mjs";
import { box, byName, openDiagram, tables, tablesUntil } from "./diagram-page.mjs";

/**
 * @typedef {import("../../database.mjs").Ctx} Ctx
 * @typedef {import("../../database.mjs").Tab} Tab
 * @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef
 */

const FIND_FIELD = "INPUT:Find a table or column";

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The tag and the accessible name of the element that has the focus
 */
function activeElement(tab) {
  return tab.page.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.getAttribute("aria-label") ?? ""}`);
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The selection bar's text, empty when none shows
 */
async function selectionBar(tab) {
  return (await tab.page.locator(".diagram-float").filter({ hasText: /Inspect|Show all tables/ }).first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
}

/**
 * @param {Tab} tab The tab
 * @param {string} name A table of the schema
 * @returns {Promise<void>}
 */
async function selectTable(tab, name) {
  const grab = await box(tab, `shop::${name}`);
  await tab.page.mouse.click(grab.x + 90, grab.y + 18);
  await tab.page.waitForTimeout(600);
}

/** @type {JourneyDef} */
export const escapeLevels = {
  id: "escape-leaves-the-find-field-then-lifts-the-focus-then-clears-the-selection",
  title: "Escape steps back one level at a time: from the find field it only leaves the field and keeps the selected table, with a table in focus it brings every table back and keeps the selection, and the next Escape clears the selection and its bar",
  entryPoint: "/modules/database/diagram Esc",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop");
    await selectTable(tab, "orders");
    const selectedBar = await selectionBar(tab);
    await tab.page.keyboard.press("f");
    await tab.page.waitForTimeout(400);
    const inField = await activeElement(tab);
    await tab.page.keyboard.press("Escape");
    await tab.page.waitForTimeout(500);
    const afterField = await activeElement(tab);
    const stillSelected = byName(await tables(tab), "orders")?.selected;
    await ctx.verify("Escape in the find field", [
      check("selecting orders shows its selection bar", /^orders Inspect Focus$/.test(selectedBar), selectedBar),
      check("F put the focus in the find field", inField === FIND_FIELD, inField),
      check("Escape took the focus out of the field", afterField !== FIND_FIELD, afterField),
      check("it did not clear the selection: orders is still selected and its bar shows", stillSelected === true && /^orders Inspect Focus$/.test(await selectionBar(tab)), [stillSelected, await selectionBar(tab)]),
    ]);
    await tab.click({ role: "button", name: "Focus" });
    const focused = await tablesUntil(tab, (drawn) => drawn.length === 3);
    const focusBar = await selectionBar(tab);
    await tab.page.keyboard.press("Escape");
    const lifted = await tablesUntil(tab, (drawn) => drawn.length === 4);
    const liftedBar = await selectionBar(tab);
    await ctx.verify("Escape in focus mode", [
      check("Focus leaves orders and its neighbours", focused.map((node) => node.name).sort().join() === "customers,order_items,orders", focused.map((node) => node.name)),
      check("the bar offers Show all tables", /Show all tables/.test(focusBar), focusBar),
      check("Escape brings all four tables back", lifted.map((node) => node.name).sort().join() === "customers,order_items,orders,products", lifted.map((node) => node.name)),
      check("the selection is kept, with its bar offering Focus again", byName(lifted, "orders")?.selected === true && /^orders Inspect Focus$/.test(liftedBar), [byName(lifted, "orders")?.selected, liftedBar]),
    ]);
    await tab.page.keyboard.press("Escape");
    const cleared = await tablesUntil(tab, (drawn) => drawn.every((node) => !node.selected));
    const clearedBar = await selectionBar(tab);
    await ctx.verify("Escape on a selection", [
      check("no table is selected", cleared.length === 4 && cleared.every((node) => !node.selected), cleared.map((node) => [node.name, node.selected])),
      check("the selection bar is gone", clearedBar === "", clearedBar),
    ]);
  },
};

export const escapeJourneys = [escapeLevels];
