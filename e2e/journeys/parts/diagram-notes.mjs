import { check, db, pick, text } from "../../database.mjs";
import { byName, drag, layoutUntil, near, notesOnCanvas, notesUntil, openDiagram, savedNotes, savedNotesUntil, tables } from "./diagram-page.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */
/** @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef */

/**
 * @param {{ x: number, y: number, width: number, height: number } | undefined} one A rectangle
 * @param {{ x: number, y: number, width: number, height: number } | undefined} other Another
 * @returns {boolean} Whether they do not cover each other
 */
function apart(one, other) {
  if (!one || !other) return false;
  return one.x + one.width <= other.x || other.x + other.width <= one.x || one.y + one.height <= other.y || other.y + other.height <= one.y;
}

/**
 * @param {Tab} tab The tab
 * @param {string} words What to type into the note being edited
 * @returns {Promise<void>}
 */
async function writeNote(tab, words) {
  await tab.page.keyboard.type(words);
  await tab.page.keyboard.press("Escape");
  await tab.page.waitForTimeout(600);
}

/** @type {JourneyDef} */
export const notes = {
  id: "n-and-the-note-button-drop-a-note-ready-to-write-and-it-is-saved-with-the-schema",
  title: "N and the Note button drop a sticky note ready to write, clear of the tables, saved with the schema with its position, size and text",
  entryPoint: "/modules/database/diagram notes",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop");
    await tab.page.keyboard.press("n");
    const added = await notesUntil(tab, (found) => found.length === 1);
    const focusedTag = await tab.page.evaluate(() => document.activeElement?.tagName ?? "");
    await writeNote(tab, "restock");
    const written = await notesUntil(tab, (found) => found[0]?.text === "restock" && found[0]?.editing === false);
    const saved = await savedNotesUntil(ctx, "shop", (items) => items.length === 1 && text(items[0], "text") === "restock");
    const drawn = await tables(tab);
    const note = written[0];
    const overlapsTable = drawn.some((node) => note !== undefined && node.x < note.x + note.width && note.x < node.x + node.width && node.y < note.y + note.height && note.y < node.y + node.height);
    await ctx.verify("the N key", [
      check("it drops one note, open for writing", added.length === 1 && added[0]?.editing === true && focusedTag === "TEXTAREA", [added, focusedTag]),
      check("the note is 220 by 140 and shows what was written", note?.width === 220 && note.height === 140 && note.text === "restock", written),
      check("it does not sit over a table", !overlapsTable, [note, drawn.map((node) => [node.name, node.x, node.y])]),
      check("the schema's notes hold it with its text, place and size", saved.length === 1 && text(saved[0], "schemaName") === "shop" && pick(saved[0], "width") === 220 && pick(saved[0], "height") === 140 && near({ x: Number(pick(saved[0], "x")), y: Number(pick(saved[0], "y")) }, note, 1.5), saved),
      tab.visible({ role: "button", name: "Delete note", exact: true }),
    ]);

    await tab.click({ role: "button", name: "Note", exact: true });
    const two = await notesUntil(tab, (found) => found.length === 2);
    const fresh = two.find((entry) => entry.id !== note?.id);
    await tab.page.keyboard.press("Escape");
    await tab.page.waitForTimeout(600);
    const second = await savedNotesUntil(ctx, "shop", (items) => items.length === 2);
    await ctx.verify("the Note button", [
      check("it adds a second note, empty and open for writing", two.length === 2 && fresh?.editing === true && fresh.text === "", two),
      check("two notes are saved", second.length === 2 && second.some((entry) => text(entry, "text") === ""), second),
      check("the two notes do not cover each other", apart(two[0], two[1]), two),
    ]);

  },
};

/** @type {JourneyDef} */
export const editing = {
  id: "a-double-click-edits-a-note-and-the-trash-button-and-delete-remove-it",
  title: "a double-click turns a note into a field holding its text, Escape saves the new text, the trash button and the Delete key remove a note from the canvas and the schema",
  entryPoint: "/modules/database/diagram notes",
  async run(ctx) {
    const first = await db(ctx, "create the first note", "POST", "/diagram/notes", { body: { schemaName: "shop", text: "restock", x: 1200, y: 40, width: 220, height: 140 } });
    const second = await db(ctx, "create the second note", "POST", "/diagram/notes", { body: { schemaName: "shop", text: "reorder", x: 1200, y: 260, width: 220, height: 140 } });
    const tab = await openDiagram(ctx, "?schema=shop");
    const note = { id: `note::${text(first.body, "id")}` };
    const fresh = { id: `note::${text(second.body, "id")}` };
    await tab.page.locator(`.vue-flow__node[data-id="${note?.id}"]`).first().dblclick();
    const editing = await notesUntil(tab, (found) => found.find((entry) => entry.id === note?.id)?.editing === true);
    await tab.page.keyboard.press("End");
    await writeNote(tab, " now");
    const edited = await savedNotesUntil(ctx, "shop", (items) => items.some((entry) => text(entry, "text") === "restock now"));
    await ctx.verify("a double-click edits", [
      check("the note turned into a field holding its text", editing.find((entry) => entry.id === note?.id)?.text === "restock", editing),
      check("the new text is saved", edited.some((entry) => text(entry, "text") === "restock now"), edited),
    ]);

    await tab.page.locator(`.vue-flow__node[data-id="${fresh?.id}"]`).first().click({ position: { x: 100, y: 12 } });
    await tab.click({ role: "button", name: "Delete note", exact: true });
    const afterTrash = await savedNotesUntil(ctx, "shop", (items) => items.length === 1);
    await ctx.verify("the trash button", [check("the note leaves the canvas and the schema", (await notesOnCanvas(tab)).length === 1 && text(afterTrash[0], "text") === "restock now", afterTrash)]);

    await tab.page.locator(`.vue-flow__node[data-id="${note?.id}"]`).first().click({ position: { x: 100, y: 12 } });
    await tab.page.keyboard.press("Delete");
    const afterKey = await savedNotesUntil(ctx, "shop", (items) => items.length === 0);
    await ctx.verify("the Delete key", [check("a selected note is removed from the canvas and the schema", (await notesOnCanvas(tab)).length === 0 && afterKey.length === 0, afterKey)]);
  },
};

/** @type {JourneyDef} */
export const sharedNotes = {
  id: "notes-belong-to-their-schema-and-everyone-reads-them",
  title: "a note created through the API appears on that schema's diagram only, in a second tab and after a reload, with its text, and a note written in one tab shows in the other after a reload",
  entryPoint: "/modules/database/diagram notes",
  async run(ctx) {
    await db(ctx, "create a shop note", "POST", "/diagram/notes", { body: { schemaName: "shop", text: "from the API", x: 1200, y: 40, width: 220, height: 140 } });
    await db(ctx, "create a vault note", "POST", "/diagram/notes", { body: { schemaName: "vault", text: "vault only", x: 1200, y: 40, width: 220, height: 140 } });
    const tab = await openDiagram(ctx, "?schema=shop");
    const shop = await notesOnCanvas(tab);
    const other = await openDiagram(ctx, "?schema=vault", tab);
    const vault = await notesOnCanvas(other);
    const second = await ctx.tab();
    await second.signIn("admin");
    const mirrored = await openDiagram(ctx, "?schema=shop", second);
    const mirror = await notesOnCanvas(mirrored);
    await mirrored.page.keyboard.press("n");
    await notesUntil(mirrored, (found) => found.length === 2);
    await writeNote(mirrored, "second tab");
    await savedNotesUntil(ctx, "shop", (items) => items.length === 2 && items.some((entry) => text(entry, "text") === "second tab"));
    await openDiagram(ctx, "?schema=shop", tab);
    const both = await notesOnCanvas(tab);
    await ctx.verify("shared notes", [
      check("the shop diagram holds the shop note at its place", shop.length === 1 && shop[0]?.text === "from the API" && near(shop[0], { x: 1200, y: 40 }, 0.5), shop),
      check("the vault diagram holds the vault note only", vault.length === 1 && vault[0]?.text === "vault only", vault),
      check("a second tab reads the same note", mirror.length === 1 && mirror[0]?.text === "from the API", mirror),
      check("a note written in the second tab shows in the first after a reload", both.map((entry) => entry.text).sort().join() === "from the API,second tab", both),
      check("the shop's notes are what the API lists", (await savedNotes(ctx, "shop")).length === 2 && (await savedNotes(ctx, "vault")).length === 1, "notes"),
    ]);
  },
};

/** @type {JourneyDef} */
export const undoing = {
  id: "undo-and-redo-cover-every-move-and-note-and-are-saved",
  title: "Ctrl Z undoes, and Ctrl Shift Z and Ctrl Y redo, each table move, note creation, note text and note deletion in order, the buttons enable and disable with the history, and every step is saved",
  entryPoint: "/modules/database/diagram undo and redo",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop");
    const base = await tables(tab);
    const at = async (/** @type {string} */ name) => byName(await tables(tab), name);
    await ctx.verify("a fresh diagram", [tab.enabled({ role: "button", name: "Undo" }, { disabled: true }), tab.enabled({ role: "button", name: "Redo" }, { disabled: true })]);
    await drag(tab, "shop::orders", { x: 140, y: 0 });
    await tab.page.waitForTimeout(800);
    await drag(tab, "shop::customers", { x: 0, y: 130 });
    await tab.page.waitForTimeout(800);
    const movedOrders = await at("orders");
    const movedCustomers = await at("customers");
    await tab.page.keyboard.press("n");
    await notesUntil(tab, (found) => found.length === 1);
    await writeNote(tab, "x");
    await tab.page.waitForTimeout(800);
    await notesUntil(tab, (found) => found[0]?.text === "x");
    await tab.page.locator(".vue-flow__node-noteNode").first().click({ position: { x: 100, y: 12 } });
    await tab.click({ role: "button", name: "Delete note", exact: true });
    await notesUntil(tab, (found) => found.length === 0);
    await ctx.verify("after five changes", [
      tab.enabled({ role: "button", name: "Undo" }),
      check("the moves stand and the note is gone", movedOrders !== undefined && movedCustomers !== undefined && (await notesOnCanvas(tab)).length === 0, [movedOrders?.x, movedCustomers?.y]),
    ]);

    const undo = async () => {
      await tab.page.keyboard.press("Control+z");
      await tab.page.waitForTimeout(500);
    };
    await undo();
    const restored = await notesUntil(tab, (found) => found.length === 1);
    await undo();
    const blank = await notesUntil(tab, (found) => found.length === 1 && found[0]?.text === "");
    await undo();
    const none = await notesUntil(tab, (found) => found.length === 0);
    await ctx.verify("undoing the note", [
      check("the first undo brings the deleted note back with its text", restored[0]?.text === "x", restored),
      check("the second takes its text away", blank[0]?.text === "", blank),
      check("the third takes the note away", none.length === 0, none),
    ]);
    await undo();
    const custBack = await at("customers");
    await ctx.verify("undoing the customers move", [check("customers is back and orders is still moved", near(custBack, byName(base, "customers"), 1) && near(await at("orders"), movedOrders, 1), custBack)]);
    await undo();
    await ctx.verify("undoing the orders move", [check("orders is back", near(await at("orders"), byName(base, "orders"), 1), await at("orders"))]);
    await undo();
    await ctx.verify("the end of the history", [tab.enabled({ role: "button", name: "Undo" }, { disabled: true })]);
    const baseline = await layoutUntil(ctx, "shop", (layout) => near(layout.orders, byName(base, "orders"), 1) && near(layout.customers, byName(base, "customers"), 1));
    await ctx.verify("undo is saved", [check("the layout API holds the undone positions", near(baseline.orders, byName(base, "orders"), 1) && near(baseline.customers, byName(base, "customers"), 1), baseline)]);

    await tab.page.keyboard.press("Control+Shift+z");
    await tab.page.waitForTimeout(500);
    const redoOrders = await at("orders");
    await tab.page.keyboard.press("Control+y");
    await tab.page.waitForTimeout(500);
    const redoCustomers = await at("customers");
    await ctx.verify("redoing the moves", [
      check("Ctrl Shift Z moves orders again, customers stays", near(redoOrders, movedOrders, 1) && near(await at("customers"), movedCustomers, 200) && redoOrders !== undefined, redoOrders),
      check("Ctrl Y moves customers again", near(redoCustomers, movedCustomers, 1), redoCustomers),
    ]);
    await tab.page.keyboard.press("Control+y");
    const back = await notesUntil(tab, (found) => found.length === 1);
    await tab.page.keyboard.press("Control+Shift+z");
    const withText = await notesUntil(tab, (found) => found[0]?.text === "x");
    await tab.page.keyboard.press("Control+y");
    const gone = await notesUntil(tab, (found) => found.length === 0);
    await ctx.verify("redoing the note", [
      check("the note is created again", back.length === 1, back),
      check("its text is written again", withText[0]?.text === "x", withText),
      check("it is deleted again", gone.length === 0, gone),
      tab.enabled({ role: "button", name: "Redo" }, { disabled: true }),
    ]);
    const finalLayout = await layoutUntil(ctx, "shop", (layout) => near(layout.orders, movedOrders, 1) && near(layout.customers, movedCustomers, 1));
    const finalNotes = await savedNotesUntil(ctx, "shop", (items) => items.length === 0);
    await ctx.verify("redo is saved", [check("the API holds the redone moves and no note", near(finalLayout.orders, movedOrders, 1) && near(finalLayout.customers, movedCustomers, 1) && finalNotes.length === 0, [finalLayout, finalNotes])]);
  },
};
