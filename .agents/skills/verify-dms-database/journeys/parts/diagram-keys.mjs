import { check, db, pick, text } from "../../database.mjs";
import { box, byName, drag, nodes, openDiagram, savedLayout, savedNotes, tables, tablesUntil, near } from "./diagram-page.mjs";

/**
 * @typedef {import("../../database.mjs").Ctx} Ctx
 * @typedef {import("../../database.mjs").Tab} Tab
 * @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef
 */

const HYDRATION_MS = 800;

/**
 * Where the view is: the screen position of a table that no journey moves.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<{ x: number, y: number }>} The table's top-left corner on screen
 */
async function viewport(tab) {
  const found = await box(tab, "shop::products");
  return { x: found.x, y: found.y };
}

/**
 * Focus on the canvas pane, away from every control.
 *
 * @param {Tab} tab The tab
 */
async function focusPane(tab) {
  const canvas = await tab.page.locator(".vue-flow").first().boundingBox();
  await tab.page.mouse.click((canvas?.x ?? 0) + (canvas?.width ?? 0) - 40, (canvas?.y ?? 0) + (canvas?.height ?? 0) - 40);
  await tab.page.waitForTimeout(300);
}

/**
 * Drags from a screen point by a distance.
 *
 * @param {Tab} tab The tab
 * @param {{ x: number, y: number }} from Where to take it
 * @param {{ x: number, y: number }} delta How far
 */
async function dragFrom(tab, from, delta) {
  await tab.page.mouse.move(from.x, from.y);
  await tab.page.mouse.down();
  await tab.page.mouse.move(from.x + delta.x / 2, from.y + delta.y / 2, { steps: 5 });
  await tab.page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 5 });
  await tab.page.mouse.up();
  await tab.page.waitForTimeout(500);
}

/** @type {JourneyDef} */
export const inspector = {
  id: "a-double-click-opens-the-inspector-and-a-relation-opens-the-other-table-in-it",
  title: "double-clicking a table opens its inspector in a drawer titled with the table's name and its Columns tab, a relation opens the other table in the same drawer, and the drawer has no position and ignores J and K",
  entryPoint: "/modules/database/diagram double-click",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop");
    const orders = await box(tab, "shop::orders");
    await tab.page.mouse.dblclick(orders.x + 90, orders.y + 18);
    const drawer = tab.page.getByRole("dialog", { name: "orders", exact: true });
    const opened = await drawer.waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
    await ctx.verify("double-click", [check("a drawer titled orders opens", opened, tab.page.url())]);
    if (!opened) return;
    await tab.page.waitForTimeout(HYDRATION_MS);
    const header = (await drawer.innerText()).replace(/\s+/g, " ");
    const tabs = (await drawer.getByRole("tab").allInnerTexts()).map((entry) => entry.replace(/\s+/g, " ").trim());
    await ctx.verify("the drawer", [
      check("titled with the table's name, one drawer", (await tab.page.getByRole("dialog").count()) === 1 && header.startsWith("orders"), header.slice(0, 120)),
      check("it opens on Columns with the four tabs", JSON.stringify(tabs) === JSON.stringify(["Columns 10", "Indexes 3", "Relations 2", "Sample row"]), tabs),
      check("it shows the columns of orders", header.includes("customer_id customers") && header.includes("coupon_id string yes"), header.slice(0, 400)),
      check("no position, since a diagram is not a list", !/Table \d+ of \d+/.test(header), header.slice(0, 120)),
    ]);
    await tab.page.keyboard.press("j");
    await tab.page.waitForTimeout(600);
    await tab.page.keyboard.press("k");
    await tab.page.waitForTimeout(600);
    const stepped = (await tab.page.getByRole("dialog").first().innerText()).replace(/\s+/g, " ");
    await ctx.verify("J and K", [check("the drawer still shows orders", (await tab.page.getByRole("dialog", { name: "orders", exact: true }).count()) === 1 && stepped.startsWith("orders"), stepped.slice(0, 80))]);
    await drawer.getByRole("tab", { name: /^Relations/ }).click();
    await tab.page.waitForTimeout(500);
    await drawer.getByRole("button", { name: /^orders\.customer_id/ }).click();
    const followed = await tab.page.getByRole("dialog", { name: "customers", exact: true }).waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
    await ctx.verify("the relation", [check("a drawer titled customers opens", followed, tab.page.url())]);
    if (!followed) return;
    await tab.page.waitForTimeout(HYDRATION_MS);
    await ctx.verify("a relation", [
      check("the same drawer now shows customers", (await tab.page.getByRole("dialog").count()) === 1 && (await tab.page.getByRole("dialog").first().innerText()).replace(/\s+/g, " ").startsWith("customers"), (await tab.page.getByRole("dialog").first().innerText()).slice(0, 80)),
      check("the page did not leave the diagram", new URL(tab.page.url()).pathname === "/modules/database/diagram", tab.page.url()),
    ]);
  },
};

/** @type {JourneyDef} */
export const findKey = {
  id: "f-focuses-the-find-field-but-not-while-writing-a-note",
  title: "F on the canvas puts the focus in 'Find a table or a column', and an f typed into a note stays in the note",
  entryPoint: "/modules/database/diagram F",
  async run(ctx) {
    const created = await db(ctx, "create a note", "POST", "/diagram/notes", { body: { schemaName: "shop", text: "", x: 1200, y: 40, width: 220, height: 140 } });
    const tab = await openDiagram(ctx, "?schema=shop");
    const active = () => tab.page.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.getAttribute("aria-label") ?? ""}`);
    await focusPane(tab);
    const before = await active();
    await tab.page.keyboard.press("f");
    await tab.page.waitForTimeout(500);
    const focused = await active();
    await ctx.verify("F on the canvas", [check("the focus was not in the field before", before !== "INPUT:Find a table or column", before), check("then it is in the find field", focused === "INPUT:Find a table or column", focused)]);
    await tab.page.keyboard.press("Escape");
    await tab.page.locator(`.vue-flow__node[data-id="note::${text(created.body, "id")}"]`).first().dblclick();
    await tab.page.waitForTimeout(600);
    await tab.page.keyboard.press("f");
    await tab.page.waitForTimeout(400);
    const inNote = await active();
    const noteText = await tab.page.locator(".vue-flow__node-noteNode textarea, .vue-flow__node textarea").first().inputValue().catch(() => "");
    await ctx.verify("f in a note", [check("the focus stays in the note", inNote.startsWith("TEXTAREA"), inNote), check("the note holds the f", noteText === "f", noteText)]);
  },
};

/** @type {JourneyDef} */
export const panTool = {
  id: "h-pans-the-canvas-and-v-selects-again",
  title: "H turns the pointer into a hand: dragging on a table moves the view and no table; V turns it back: dragging a table moves that table",
  entryPoint: "/modules/database/diagram H and V",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop");
    const before = await tables(tab);
    const viewBefore = await viewport(tab);
    await focusPane(tab);
    await tab.page.keyboard.press("h");
    await tab.page.waitForTimeout(400);
    const grab = await box(tab, "shop::orders");
    await dragFrom(tab, { x: grab.x + 90, y: grab.y + 18 }, { x: -120, y: 70 });
    const panned = await viewport(tab);
    const afterPan = await tables(tab);
    await ctx.verify("the hand", [
      check("the view moved by the distance dragged", Math.abs(panned.x - viewBefore.x + 120) <= 6 && Math.abs(panned.y - viewBefore.y - 70) <= 6, [viewBefore, panned]),
      check("no table moved", before.every((entry) => near(byName(afterPan, entry.name), entry, 0.5)), afterPan.map((entry) => [entry.name, entry.x, entry.y])),
    ]);
    await focusPane(tab);
    await tab.page.keyboard.press("v");
    await tab.page.waitForTimeout(400);
    const viewAfterV = await viewport(tab);
    const again = await box(tab, "shop::orders");
    await dragFrom(tab, { x: again.x + 90, y: again.y + 18 }, { x: 80, y: 60 });
    const moved = await tablesUntil(tab, (drawn) => (byName(drawn, "orders")?.x ?? 0) !== (byName(afterPan, "orders")?.x ?? 0));
    const viewEnd = await viewport(tab);
    await ctx.verify("the arrow again", [
      check("the dragged table moved", (byName(moved, "orders")?.x ?? 0) > (byName(afterPan, "orders")?.x ?? 0) + 40, [byName(afterPan, "orders")?.x, byName(moved, "orders")?.x]),
      check("the view stayed", Math.abs(viewEnd.x - viewAfterV.x) <= 2 && Math.abs(viewEnd.y - viewAfterV.y) <= 2, [viewAfterV, viewEnd]),
    ]);
  },
};

/** @type {JourneyDef} */
export const fitInside = {
  id: "fit-view-keeps-every-table-inside-the-canvas",
  title: "after zooming in, 1 and the Fit view button bring every table of a large schema back inside the canvas",
  entryPoint: "/modules/database/diagram 1",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=dms-core");
    const inside = async () => {
      const canvas = await tab.page.locator(".vue-flow").first().boundingBox();
      const drawn = (await nodes(tab)).filter((entry) => entry.kind === "tableNode");
      const boxes = [];
      for (const entry of drawn) boxes.push({ name: entry.name, ...(await box(tab, entry.id)) });
      const out = boxes.filter((entry) => entry.x < (canvas?.x ?? 0) - 1 || entry.y < (canvas?.y ?? 0) - 1 || entry.x + entry.width > (canvas?.x ?? 0) + (canvas?.width ?? 0) + 1 || entry.y + entry.height > (canvas?.y ?? 0) + (canvas?.height ?? 0) + 1);
      return { total: boxes.length, out: out.map((entry) => entry.name) };
    };
    await focusPane(tab);
    await tab.page.keyboard.press("0");
    await tab.page.waitForTimeout(800);
    const zoomed = await inside();
    await tab.page.keyboard.press("1");
    await tab.page.waitForTimeout(1000);
    const fitted = await inside();
    await tab.page.keyboard.press("0");
    await tab.page.waitForTimeout(800);
    await tab.page.getByRole("button", { name: "Fit view", exact: true }).click();
    await tab.page.waitForTimeout(1000);
    const button = await inside();
    await ctx.verify("fit view", [
      check("at 100 % some of the twelve tables are outside the canvas", zoomed.total >= 12 && zoomed.out.length > 0, zoomed),
      check("1 brings all of them inside", fitted.total === zoomed.total && fitted.out.length === 0, fitted),
      check("the button does the same", button.total === zoomed.total && button.out.length === 0, button),
    ]);
  },
};

/** @type {JourneyDef} */
export const shortcutsPage = {
  id: "the-shortcuts-settings-page-lists-the-diagram-shortcuts",
  title: "the DMS Shortcuts settings page lists the diagram's shortcuts under 'Database · diagram', with the keys of the docs table",
  entryPoint: "/settings/shortcuts",
  async run(ctx) {
    const tab = await ctx.tab();
    await tab.signIn("admin");
    await tab.goto("/settings/shortcuts");
    const listedGroup = await tab.page.getByText("Database · diagram").first().waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
    await ctx.verify("the group", [check("the page has a Database · diagram group", listedGroup, tab.page.url())]);
    if (!listedGroup) return;
    const body = (await tab.page.locator("body").innerText()).replace(/\s+/g, " ");
    const start = body.indexOf("Database · diagram");
    const rest = body.slice(start + "Database · diagram".length);
    const next = rest.search(/Database · (?!diagram)/);
    const group = next === -1 ? rest.slice(0, 900) : rest.slice(0, next);
    const rows = [
      ["Find a table", "F"],
      ["Add a note", "N"],
      ["Select tool", "V"],
      ["Pan tool", "H"],
      ["Fit the view", "1"],
      ["Zoom to 100 %", "0"],
      ["Undo", "CTRL Z"],
      ["Redo", "CTRL SHIFT Z"],
      ["Redo", "CTRL Y"],
      ["Step back", "ESC"],
    ];
    await ctx.verify("the diagram group", rows.map(([label, keys]) => check(`${label} is listed with ${keys}`, new RegExp(`${label}[^A-Za-z0-9]*(?:[^]{0,80}?)${keys}`, "i").test(group), group.slice(0, 500))));
  },
};

/** @type {JourneyDef} */
export const restart = {
  id: "the-layout-and-the-notes-survive-a-backend-restart",
  title: "a table dragged to a new place and a note written on the diagram are where they were left after the backend restarts",
  entryPoint: "/modules/database/diagram, GET /api/database/diagram/layout, /notes",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop");
    const before = byName(await tables(tab), "orders");
    await drag(tab, "shop::orders", { x: 170, y: 120 });
    const layout = await (async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const saved = await savedLayout(ctx, "shop");
        if (saved.orders) return saved;
        await tab.page.waitForTimeout(250);
      }
      return {};
    })();
    await db(ctx, "add a note", "POST", "/diagram/notes", { body: { schemaName: "shop", text: "kept over a restart", x: 1200, y: 60, width: 220, height: 140 } });
    await ctx.restartBackend();
    const again = await ctx.tab();
    await again.signIn("admin");
    const reopened = await openDiagram(ctx, "?schema=shop", again);
    const after = byName(await tablesUntil(reopened, (drawn) => drawn.length === 4), "orders");
    const notes = await savedNotes(ctx, "shop", "notes after the restart");
    const onCanvas = (await reopened.page.locator(".vue-flow__node").allInnerTexts()).join("|");
    await ctx.verify("after the restart", [
      check("the table was moved by the drag", Boolean(before && layout.orders && layout.orders.x > before.x + 100), [before?.x, layout.orders]),
      check("it is still there", near(after, layout.orders, 1.5), [after?.x, after?.y, layout.orders]),
      check("the API holds the note", notes.length === 1 && text(notes[0], "text") === "kept over a restart", notes),
      check("the canvas draws the note", onCanvas.includes("kept over a restart") || (await reopened.page.locator(".vue-flow__node textarea").count()) > 0, onCanvas.slice(0, 200)),
      check("the layout API holds it", pick(await savedLayout(ctx, "shop"), "orders") !== undefined, "layout"),
    ]);
  },
};

/** @type {JourneyDef} */
export const escape = {
  id: "escape-steps-back-from-a-selected-table",
  title: "a click selects a table and Escape clears the selection",
  entryPoint: "/modules/database/diagram Esc",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop");
    const grab = await box(tab, "shop::products");
    await tab.page.mouse.click(grab.x + 90, grab.y + 18);
    await tab.page.waitForTimeout(600);
    const selected = byName(await tables(tab), "products")?.selected;
    await tab.page.keyboard.press("Escape");
    await tab.page.waitForTimeout(600);
    const cleared = byName(await tables(tab), "products")?.selected;
    await ctx.verify("Escape", [check("the clicked table is selected", selected === true, selected), check("Escape clears the selection", cleared === false, cleared)]);
  },
};

export const keyJourneys = [escape, inspector, findKey, panTool, fitInside, shortcutsPage, restart];
