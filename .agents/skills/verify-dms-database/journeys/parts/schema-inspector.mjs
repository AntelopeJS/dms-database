import { check } from "../../database.mjs";
import { listUntil, openSchemas, params, paramsUntil } from "./schema-page.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */
/** @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef */

const LIST = "?scope=shop&instance=eu";
const WAIT_MS = 20_000;

/**
 * Opens the Schemas page on a table's inspector through its URL and waits for the drawer.
 *
 * @param {Ctx} ctx The journey
 * @param {string} query The query string with `record=`
 * @param {string} title The table named by the drawer
 * @returns {Promise<Tab>} The tab
 */
export async function openInspector(ctx, query, title) {
  const tab = await openSchemas(ctx, query);
  await tab.page.getByRole("dialog", { name: title, exact: true }).waitFor({ state: "visible", timeout: WAIT_MS });
  await tab.page.waitForTimeout(800);
  return tab;
}

/**
 * @param {Tab} tab The tab
 * @returns {import("playwright-core").Locator} The open drawer
 */
export function drawer(tab) {
  return tab.page.getByRole("dialog").first();
}

/**
 * The header's text lines: schema, instances badge, rows, structure.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<{ eyebrow: string, instances: string, rows: string, structure: string, position: string, title: string }>} The facts
 */
export async function facts(tab) {
  const dialog = drawer(tab);
  const header = await dialog.locator("header").first().innerText();
  const lines = header.split("\n").map((line) => line.trim()).filter(Boolean);
  const position = await dialog.getByText(/^Table \d+ of \d+$/).first().innerText().catch(() => "");
  const title = await dialog.getByRole("heading", { level: 2 }).first().innerText().catch(() => "");
  return {
    eyebrow: lines.find((line) => line.startsWith("Schema ·")) ?? "",
    instances: lines.find((line) => /^\d+ instances?$/.test(line)) ?? "",
    rows: (lines.find((line) => /^[\d,]+ rows?/.test(line)) ?? "").replace(/\s*·\s*$/, ""),
    structure: lines.find((line) => /columns? ·/.test(line)) ?? "",
    position,
    title,
  };
}

/**
 * Waits until the drawer's heading names a table, and returns it.
 *
 * @param {Tab} tab The tab
 * @param {string} name The table
 * @returns {Promise<string>} The position text then
 */
export async function titledUntil(tab, name) {
  const deadline = Date.now() + WAIT_MS;
  let seen = await facts(tab);
  while (seen.title !== name && Date.now() < deadline) {
    await tab.page.waitForTimeout(250);
    seen = await facts(tab);
  }
  return seen.position;
}

/**
 * @param {Tab} tab The tab
 * @param {string} position The position text awaited
 * @returns {Promise<string>} The position read last
 */
export async function positionUntil(tab, position) {
  const deadline = Date.now() + WAIT_MS;
  let seen = (await facts(tab)).position;
  while (seen !== position && Date.now() < deadline) {
    await tab.page.waitForTimeout(250);
    seen = (await facts(tab)).position;
  }
  return seen;
}

/** @type {JourneyDef} */
export const stepping = {
  id: "a-row-click-opens-the-inspector-and-previous-next-j-and-k-step-through-the-list",
  title: "clicking a row opens the inspector headed by the table and Table N of M, the URL keeps ?record=schema::table, Previous, Next, J and K step through the list as shown, stop at its ends, and Close and a record outside the list behave",
  entryPoint: "/modules/database/schemas?record=",
  async run(ctx) {
    const tab = await openSchemas(ctx, LIST);
    await listUntil(tab, (rows) => rows.length === 4);
    await tab.click({ role: "row", name: /^orders/ });
    const open = await titledUntil(tab, "orders");
    const record = await paramsUntil(tab, (query) => query.get("record") === "shop::orders");
    await ctx.verify("a row click opens the inspector", [
      tab.visible({ role: "dialog", name: "orders" }),
      check("the header holds the table's position in the list", open === "Table 2 of 4", open),
      check("the URL keeps the open table", record.get("record") === "shop::orders" && record.get("scope") === "shop" && record.get("instance") === "eu", tab.page.url()),
      tab.visible({ role: "button", name: "Previous", within: { role: "dialog" } }),
    ]);

    await tab.page.keyboard.press("j");
    const next = await positionUntil(tab, "Table 3 of 4");
    const afterJ = await paramsUntil(tab, (query) => query.get("record") === "shop::customers");
    await ctx.verify("J steps to the next table of the list", [
      check("the position moved", next === "Table 3 of 4", next),
      check("the drawer is headed by the next table", (await facts(tab)).title === "customers", await facts(tab)),
      check("the URL follows", afterJ.get("record") === "shop::customers", tab.page.url()),
    ]);
    await tab.page.keyboard.press("k");
    const back = await positionUntil(tab, "Table 2 of 4");
    await ctx.verify("K steps back", [check("orders again", back === "Table 2 of 4" && (await facts(tab)).title === "orders" && params(tab).get("record") === "shop::orders", [back, tab.page.url()])]);

    await tab.click({ role: "button", name: "Next", within: { role: "dialog" } });
    const byButton = await positionUntil(tab, "Table 3 of 4");
    await tab.click({ role: "button", name: "Previous", within: { role: "dialog" } });
    const byPrevious = await positionUntil(tab, "Table 2 of 4");
    await ctx.verify("the Next and Previous buttons step too", [check("next then previous", byButton === "Table 3 of 4" && byPrevious === "Table 2 of 4", [byButton, byPrevious])]);

    await tab.page.keyboard.press("k");
    await positionUntil(tab, "Table 1 of 4");
    await tab.page.keyboard.press("k");
    await tab.page.waitForTimeout(800);
    const first = await facts(tab);
    const previousDisabled = await drawer(tab).getByRole("button", { name: "Previous", exact: true }).isEnabled();
    await ctx.verify("the first table", [
      check("Table 1 of 4 is order_items, the most rows", first.position === "Table 1 of 4" && first.title === "order_items", first),
      check("K does nothing there and Previous is disabled", previousDisabled === false && first.position === "Table 1 of 4", previousDisabled),
    ]);
    for (const _ of [1, 2, 3]) await tab.page.keyboard.press("j");
    await positionUntil(tab, "Table 4 of 4");
    await tab.page.keyboard.press("j");
    await tab.page.waitForTimeout(800);
    const last = await facts(tab);
    const nextDisabled = await drawer(tab).getByRole("button", { name: "Next", exact: true }).isEnabled();
    await ctx.verify("the last table", [
      check("Table 4 of 4 is products", last.position === "Table 4 of 4" && last.title === "products", last),
      check("J does nothing there and Next is disabled", nextDisabled === false && params(tab).get("record") === "shop::products", nextDisabled),
    ]);

    await tab.click({ role: "button", name: "Close", within: { role: "dialog" } });
    const closed = await paramsUntil(tab, (query) => !query.has("record"));
    await ctx.verify("Close", [tab.visible({ role: "dialog" }, { hidden: true }), check("the URL drops the record and keeps the filters", !closed.has("record") && closed.get("scope") === "shop", tab.page.url())]);

    const direct = await openInspector(ctx, `${LIST}&record=shop::products`, "products");
    const position = (await facts(direct)).position;
    await ctx.verify("a record in the URL opens its inspector", [check("products is the 4th of 4 as the list shows them", position === "Table 4 of 4", position)]);

    const outside = await openInspector(ctx, "?scope=shop&q=order&record=shop::customers", "customers");
    const outsideFacts = await facts(outside);
    await ctx.verify("a record the filters leave out", [
      check("it opens anyway, headed by its name", outsideFacts.title === "customers", outsideFacts),
      check("it has no position in a list that does not hold it", outsideFacts.position === "", outsideFacts),
    ]);

    const unknown = await openSchemas(ctx, "?record=shop::nothing");
    const unknownParams = await paramsUntil(unknown, (query) => !query.has("record"));
    await ctx.verify("an unknown record", [unknown.visible({ role: "dialog" }, { hidden: true }), check("it leaves the URL", !unknownParams.has("record"), unknown.page.url())]);
  },
};

/** @type {JourneyDef} */
export const resizing = {
  id: "dragging-the-drawer-edge-resizes-it-and-it-opens-at-the-width-you-left-it",
  title: "dragging the inspector's edge widens and narrows the drawer, and the next table opened takes the width last left, also after closing it",
  entryPoint: "/modules/database/schemas drawer edge",
  async run(ctx) {
    const tab = await openInspector(ctx, `${LIST}&record=shop::orders`, "orders");
    const width = async () => (await drawer(tab).evaluate((element) => element.getBoundingClientRect().width)) ?? 0;
    const grip = tab.page.getByRole("separator", { name: "Resize the drawer" });
    const drag = async (/** @type {number} */ delta) => {
      const box = await grip.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      await tab.page.mouse.move(box.x, box.y);
      await tab.page.mouse.down();
      await tab.page.mouse.move(box.x + delta / 2, box.y, { steps: 6 });
      await tab.page.mouse.move(box.x + delta, box.y, { steps: 6 });
      await tab.page.mouse.up();
      await tab.page.waitForTimeout(600);
    };
    const initial = await width();
    await drag(-220);
    const wider = await width();
    await drag(120);
    const narrower = await width();
    await ctx.verify("the edge resizes the drawer", [
      check("dragging left widens it by about the distance", Math.abs(wider - initial - 220) <= 12, [initial, wider]),
      check("dragging right narrows it by about the distance", Math.abs(wider - narrower - 120) <= 12, [wider, narrower]),
    ]);
    await tab.click({ role: "button", name: "Close", within: { role: "dialog" } });
    await tab.visible({ role: "dialog" }, { hidden: true });
    await tab.click({ role: "row", name: /^customers/ });
    await tab.page.getByRole("dialog", { name: "customers", exact: true }).waitFor({ state: "visible", timeout: WAIT_MS });
    await tab.page.waitForTimeout(800);
    const reopened = await width();
    await tab.page.keyboard.press("j");
    await positionUntil(tab, "Table 4 of 4");
    await tab.page.waitForTimeout(500);
    const stepped = await width();
    await ctx.verify("it opens at the width last left", [
      check("another table opens at that width", Math.abs(reopened - narrower) <= 2, [reopened, narrower]),
      check("stepping to the next table keeps it", Math.abs(stepped - narrower) <= 2, [stepped, narrower]),
    ]);
  },
};
