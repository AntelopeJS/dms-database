import { check, db, list, pick, text } from "../../database.mjs";
import { putLayout, positionsOf } from "./diagram-layout.mjs";
import { byName, layoutUntil, near, openDiagram, savedLayout, tables, toggleFold } from "./diagram-page.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */
/** @typedef {import("./diagram-page.mjs").Node} Node */
/** @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef */

const GOLDEN_VAULT = { accounts: { x: 648, y: 0 }, plain_notes: { x: 648, y: 228 }, parents_registry: { x: 352, y: 268 }, parents_links: { x: 0, y: 404 }, wide_records: { x: 0, y: 0 } };
const SCRAMBLED = { customers: { x: 40, y: 700 }, orders: { x: 40, y: 20 }, order_items: { x: 700, y: 20 }, products: { x: 400, y: 400 } };

/**
 * @param {Tab} tab The tab
 * @returns {import("playwright-core").Locator} The preview bar
 */
function barOf(tab) {
  return tab.page.locator(".diagram-float").filter({ hasText: "Previewing auto layout." }).first();
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The text of the preview bar once it shows, empty when it does not within ten seconds
 */
async function previewBar(tab) {
  return (await barOf(tab).innerText({ timeout: 10_000 }).catch(() => "")).replace(/\s+/g, " ").trim();
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<boolean>} Whether the preview bar is gone now, read once after the journey's own pause
 */
async function previewGone(tab) {
  return (await barOf(tab).count()) === 0;
}

/**
 * @param {Node[]} drawn Tables drawn
 * @returns {boolean} Whether no two tables cover each other
 */
export function disjoint(drawn) {
  return drawn.every((one, index) => drawn.slice(index + 1).every((two) => one.x + one.width <= two.x || two.x + two.width <= one.x || one.y + one.height <= two.y || two.y + two.height <= one.y));
}

/** @type {JourneyDef} */
export const preview = {
  id: "auto-layout-previews-the-arrangement-and-keep-or-discard-decides",
  title: "Auto layout shows the computed arrangement with Previewing auto layout., how many tables moved (singular for one), Discard and Keep layout, saves nothing while previewing, Discard restores the team's layout, Keep saves the arrangement and Undo brings the previous one back",
  entryPoint: "/modules/database/diagram Auto layout",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop");
    const automatic = positionsOf(await tables(tab));
    await putLayout(ctx, "shop", SCRAMBLED);
    await openDiagram(ctx, "?schema=shop", tab);
    await tab.click({ role: "button", name: "Auto layout" });
    await tab.page.waitForTimeout(1200);
    const bar = await previewBar(tab);
    const shown = positionsOf(await tables(tab));
    await ctx.verify("the preview", [
      check("the bar says it previews and counts the tables moved", bar.startsWith("Previewing auto layout. 4 tables moved."), bar),
      tab.visible({ role: "button", name: "Keep layout" }),
      tab.visible({ role: "button", name: "Discard" }),
      check("the tables show the automatic arrangement", Object.keys(automatic).every((name) => near(shown[name], automatic[name], 0.5)), shown),
      tab.enabled({ role: "button", name: "Auto layout" }, { disabled: true }),
      tab.enabled({ role: "button", name: "Undo" }, { disabled: true }),
    ]);
    await tab.page.waitForTimeout(2500);
    const duringPreview = await savedLayout(ctx, "shop", "read the layout during the preview");
    await ctx.verify("nothing is saved while previewing", [check("the API still holds the team's layout", JSON.stringify(duringPreview) === JSON.stringify(SCRAMBLED), duringPreview)]);

    await tab.click({ role: "button", name: "Discard" });
    await tab.page.waitForTimeout(1000);
    const discarded = positionsOf(await tables(tab));
    await ctx.verify("Discard", [
      check("the tables go back to the team's layout", Object.entries(SCRAMBLED).every(([name, point]) => near(discarded[name], point, 0.5)), discarded),
      check("the preview bar is gone", await previewGone(tab), "preview bar"),
      check("the API still holds the team's layout", JSON.stringify(await savedLayout(ctx, "shop")) === JSON.stringify(SCRAMBLED), "layout"),
    ]);

    await tab.click({ role: "button", name: "Auto layout" });
    await tab.page.waitForTimeout(1000);
    await tab.click({ role: "button", name: "Keep layout" });
    const kept = await layoutUntil(ctx, "shop", (layout) => near(layout.customers, automatic.customers, 0.5));
    const keptShown = positionsOf(await tables(tab));
    await ctx.verify("Keep layout", [
      check("the arrangement is saved for all four tables", Object.keys(automatic).every((name) => near(kept[name], automatic[name], 0.5)), kept),
      check("the canvas shows it and the bar is gone", Object.keys(automatic).every((name) => near(keptShown[name], automatic[name], 0.5)) && (await previewGone(tab)), keptShown),
      tab.enabled({ role: "button", name: "Undo" }),
    ]);
    await tab.click({ role: "button", name: "Undo" });
    const undone = await layoutUntil(ctx, "shop", (layout) => near(layout.customers, SCRAMBLED.customers, 0.5));
    await ctx.verify("Undo after Keep layout", [check("the team's previous layout is back and saved", Object.entries(SCRAMBLED).every(([name, point]) => near(undone[name], point, 0.5)), undone)]);

    await putLayout(ctx, "shop", { customers: { x: 1500, y: 1500 } });
    await openDiagram(ctx, "?schema=shop", tab);
    await tab.click({ role: "button", name: "Auto layout" });
    await tab.page.waitForTimeout(1000);
    const single = await previewBar(tab);
    await tab.page.keyboard.press("Escape");
    await tab.page.waitForTimeout(800);
    await ctx.verify("one table placed", [
      check("one table moved reads in the singular", single.startsWith("Previewing auto layout. 1 table moved."), single),
      check("Escape discards the preview", (await previewGone(tab)) && near(byName(await tables(tab), "customers"), { x: 1500, y: 1500 }, 0.5), "preview bar"),
    ]);
  },
};

/** @type {JourneyDef} */
export const arrangement = {
  id: "auto-layout-keeps-groups-together-and-clear-of-notes-that-never-move",
  title: "the computed arrangement puts related tables left to right along their relations, the largest group first, never lets two tables cover each other, counts folded tables at their folded height, and keeps clear of the notes, which never move",
  entryPoint: "/modules/database/diagram Auto layout",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop");
    const shop = await tables(tab);
    const x = (/** @type {string} */ name) => byName(shop, name)?.x ?? Number.NaN;
    await ctx.verify("the shop group", [
      check("relations read left to right: order_items, then orders, then customers", x("order_items") < x("orders") && x("orders") < x("customers"), [x("order_items"), x("orders"), x("customers")]),
      check("products sits in the rank of the table that points to it", x("products") === x("orders"), [x("products"), x("orders")]),
      check("no two tables cover each other", disjoint(shop), shop.map((node) => [node.name, node.x, node.y])),
    ]);
    const vault = await openDiagram(ctx, "?schema=vault", tab);
    const first = await tables(vault);
    const vx = (/** @type {string} */ name) => byName(first, name)?.x ?? Number.NaN;
    const vy = (/** @type {string} */ name) => byName(first, name)?.y ?? Number.NaN;
    const origin = { x: Math.min(...first.map((node) => node.x)), y: Math.min(...first.map((node) => node.y)) };
    const group = ["parents_links", "parents_registry", "wide_records"];
    const groupOrigin = { x: Math.min(...group.map(vx)), y: Math.min(...group.map(vy)) };
    await ctx.verify("the vault arrangement", [
      check("the tables pointing at parents_registry sit left of it", vx("parents_links") < vx("parents_registry") && vx("wide_records") < vx("parents_registry"), group.map(vx)),
      check("the largest group is placed first, at the origin", near(groupOrigin, origin, 0.5), [groupOrigin, origin]),
      check("the tables without relations come after the group, accounts before plain_notes in name order", [vx("accounts"), vy("accounts")].every(Number.isFinite) && (vy("plain_notes") > vy("accounts") || (vy("plain_notes") === vy("accounts") && vx("plain_notes") > vx("accounts"))), [vx("accounts"), vy("accounts"), vx("plain_notes"), vy("plain_notes")]),
      check("no two tables cover each other", disjoint(first), first.map((node) => [node.name, node.x, node.y, node.height])),
      check("the whole arrangement is the one the rules give, folded tables at their folded height, 64 apart", Object.entries(GOLDEN_VAULT).every(([name, point]) => near(positionsOf(first)[name], point, 0.5)), positionsOf(first)),
    ]);

    await putLayout(ctx, "vault", { wide_records: { x: 3000, y: 3000 } });
    await openDiagram(ctx, "?schema=vault", tab);
    await toggleFold(tab, "vault::wide_records");
    await tab.page.waitForTimeout(500);
    await tab.click({ role: "button", name: "Auto layout" });
    await tab.page.waitForTimeout(1200);
    const unfoldedRun = positionsOf(await tables(tab));
    const firstPositions = positionsOf(first);
    await ctx.verify("folded height", [check("an unfolded table is laid out at its folded height, as when folded", Object.keys(firstPositions).every((name) => near(unfoldedRun[name], firstPositions[name], 0.5)), [unfoldedRun, firstPositions])]);
    await tab.click({ role: "button", name: "Discard" });

    const note = await db(ctx, "put a note where the group would go", "POST", "/diagram/notes", { body: { schemaName: "vault", text: "keep clear", x: 0, y: 0, width: 220, height: 140 } });
    await putLayout(ctx, "vault", { wide_records: { x: 3000, y: 3000 } });
    await openDiagram(ctx, "?schema=vault", tab);
    const clear = await tables(tab);
    const rect = { x: 0, y: 0, width: 220, height: 140 };
    const overlaps = (/** @type {Node} */ node) => node.x < rect.x + rect.width && rect.x < node.x + node.width && node.y < rect.y + rect.height && rect.y < node.y + node.height;
    const autoNote = clear.filter((node) => node.name !== "wide_records");
    await tab.click({ role: "button", name: "Auto layout" });
    await tab.page.waitForTimeout(1200);
    await tab.click({ role: "button", name: "Keep layout" });
    const kept = await tables(tab);
    const layout = await layoutUntil(ctx, "vault", (saved) => Object.keys(saved).length === 5 && !near(saved.wide_records, { x: 3000, y: 3000 }, 1));
    const notes = await db(ctx, "read the notes", "GET", "/diagram/notes?schema=vault");
    await ctx.verify("a note on the canvas", [
      check("unplaced tables do not cover the note", autoNote.every((node) => !overlaps(node)), autoNote.map((node) => [node.name, node.x, node.y])),
      check("the arranged tables do not cover the note", kept.every((node) => !overlaps(node)), kept.map((node) => [node.name, node.x, node.y])),
      check("the arrangement was saved for all five tables", Object.keys(layout).length === 5, layout),
      check("the note did not move", text(note.body, "id").length > 0 && list(notes.body, "items").some((entry) => pick(entry, "x") === 0 && pick(entry, "y") === 0 && text(entry, "id") === text(note.body, "id")), notes.body),
    ]);
  },
};
