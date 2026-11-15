import { check, db } from "../../database.mjs";
import { box, byName, drag, layoutUntil, near, openDiagram, saveStatus, tables, tablesUntil } from "./diagram-page.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */
/** @typedef {import("./diagram-page.mjs").Node} Node */
/** @typedef {import("./diagram-page.mjs").Point} Point */
/** @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef */

/**
 * @param {Node[]} drawn The tables drawn
 * @returns {Record<string, Point>} Their positions by name
 */
export function positionsOf(drawn) {
  return Object.fromEntries(drawn.map((node) => [node.name, { x: node.x, y: node.y }]));
}

/**
 * Saves a layout through the API.
 *
 * @param {Ctx} ctx The journey
 * @param {string} schema The schema
 * @param {Record<string, Point>} positions The positions by table name
 * @returns {Promise<void>}
 */
export async function putLayout(ctx, schema, positions) {
  await db(ctx, `save the ${schema} layout`, "PUT", `/diagram/layout/${schema}`, { body: { positions } });
}

/** @type {JourneyDef} */
export const dragging = {
  id: "dragging-a-table-saves-the-layout-and-everyone-reads-it",
  title: "dragging a table moves it by the distance dragged, the status reads Layout saved, the layout API holds that table's position, a reload and a second tab read it, and the tables not moved stay where the automatic layout puts them",
  entryPoint: "/modules/database/diagram drag",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop");
    const before = await tables(tab);
    const start = byName(before, "orders");
    const screenBefore = await box(tab, "shop::orders");
    await drag(tab, "shop::orders", { x: 160, y: 110 });
    const screenAfter = await box(tab, "shop::orders");
    const after = await tablesUntil(tab, (drawn) => byName(drawn, "orders")?.x !== start?.x);
    const moved = byName(after, "orders");
    const status = await saveStatus(tab, /Layout saved · just now/);
    const saved = await layoutUntil(ctx, "shop", (layout) => layout.orders !== undefined);
    await ctx.verify("a dragged table", [
      check("it followed the pointer by about the distance dragged", Math.abs(screenAfter.x - screenBefore.x - 160) <= 24 && Math.abs(screenAfter.y - screenBefore.y - 110) <= 18, [screenBefore, screenAfter]),
      check("its canvas position changed", moved !== undefined && start !== undefined && moved.x > start.x + 100 && moved.y > start.y + 70, [start?.x, start?.y, moved?.x, moved?.y]),
      check("the other tables did not move", ["customers", "order_items", "products"].every((name) => near(byName(after, name), byName(before, name), 0.5)), positionsOf(after)),
      status,
      check("the layout API holds the moved table's position, and only that table's", near(saved.orders, moved, 1.5) && Object.keys(saved).join() === "orders", saved),
    ]);
    await tab.reload();
    await tablesUntil(tab, (drawn) => drawn.length === 4);
    await tab.page.waitForTimeout(1500);
    const reloaded = await tables(tab);
    await ctx.verify("a reload", [
      check("the moved table is where it was left", near(byName(reloaded, "orders"), moved, 1.5), byName(reloaded, "orders")),
      check("the others are where the automatic layout puts them", ["customers", "order_items", "products"].every((name) => near(byName(reloaded, name), byName(before, name), 1.5)), positionsOf(reloaded)),
    ]);

    const second = await ctx.tab();
    await second.signIn("admin");
    const other = await openDiagram(ctx, "?schema=shop", second);
    const seen = await tables(other);
    await ctx.verify("a second tab", [check("it reads the same layout", near(byName(seen, "orders"), moved, 1.5) && near(byName(seen, "customers"), byName(before, "customers"), 1.5), positionsOf(seen))]);
    await drag(other, "shop::customers", { x: -90, y: 140 });
    const both = await layoutUntil(ctx, "shop", (layout) => layout.customers !== undefined);
    await tab.reload();
    await tablesUntil(tab, (drawn) => drawn.length === 4);
    await tab.page.waitForTimeout(1500);
    const shared = await tables(tab);
    await ctx.verify("a move made in the second tab", [
      check("it is saved next to the first", Object.keys(both).sort().join() === "customers,orders", both),
      check("the first tab reads both after a reload", near(byName(shared, "customers"), both.customers, 1.5) && near(byName(shared, "orders"), moved, 1.5), positionsOf(shared)),
    ]);
  },
};

/** @type {JourneyDef} */
export const placement = {
  id: "a-table-not-placed-yet-takes-its-automatic-place-and-placed-tables-stay",
  title: "tables the team has not placed take the place the automatic layout gives them while the placed ones stay where they were put, until Auto layout is kept",
  entryPoint: "/modules/database/diagram layout",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop");
    const automatic = positionsOf(await tables(tab));
    await putLayout(ctx, "shop", { customers: { x: 900, y: 600 } });
    await openDiagram(ctx, "?schema=shop", tab);
    const partial = positionsOf(await tables(tab));
    await ctx.verify("one table placed", [
      check("the placed table is where the team put it", near(partial.customers, { x: 900, y: 600 }, 0.5), partial.customers),
      check("the others take their automatic places", ["orders", "order_items", "products"].every((name) => near(partial[name], automatic[name], 0.5)), [partial, automatic]),
    ]);
    const scrambled = { customers: { x: 40, y: 700 }, orders: { x: 40, y: 20 }, order_items: { x: 700, y: 20 }, products: { x: 400, y: 400 } };
    await putLayout(ctx, "shop", scrambled);
    await openDiagram(ctx, "?schema=shop", tab);
    const placed = positionsOf(await tables(tab));
    await ctx.verify("every table placed", [check("they stay where they were put, whatever the automatic layout says", Object.entries(scrambled).every(([name, point]) => near(placed[name], point, 0.5)), placed)]);
    await tab.click({ role: "button", name: "Auto layout" });
    await tab.page.waitForTimeout(1200);
    const previewed = positionsOf(await tables(tab));
    await ctx.verify("until Auto layout runs", [check("Auto layout brings them to the automatic arrangement", Object.keys(automatic).every((name) => near(previewed[name], automatic[name], 0.5)), [previewed, automatic])]);
  },
};
