import { guarded } from "../../guard.mjs";
import { check, show } from "../../database.mjs";
import { openTable, settle } from "./browse.mjs";
import { cellOf, cellState, openEditor, openReview, reviewLabel, saveStaged, storedRow, typeInto } from "./edit.mjs";
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
const nullAndEscape = {
  id: "null-empties-a-cell-and-backslash-null-is-the-text-null",
  title: "typing null empties a cell of any type, \\null stores the text null and \\\\null the text \\null, an editor opens a cell holding the text null escaped so committing it unchanged keeps it, and an emptied text is the empty text, not null",
  entryPoint: "/modules/database/data cell editor",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await shopTab(ctx, "customers", "eu");
    await typeInto(tab, "eu_cus_002", "company", "null");
    await typeInto(tab, "eu_cus_002", "email", "\\null");
    await typeInto(tab, "eu_cus_002", "credit_limit", "null");
    await typeInto(tab, "eu_cus_003", "company", "");
    const company = await cellState(tab, "eu_cus_002", "company");
    const email = await cellState(tab, "eu_cus_002", "email");
    const limit = await cellState(tab, "eu_cus_002", "credit_limit");
    const blank = await cellState(tab, "eu_cus_003", "company");
    const review = await openReview(tab);
    await tab.click({ role: "button", name: "Keep editing" });
    await ctx.verify("staged", [
      check("null over a text: the old text struck, the null badge", company.struck === "Fabrikam" && company.text === "Fabrikam null", company),
      check("\\null stages the text null, not an empty cell", email.struck === "buyer2@fabrikam.test" && email.text === "buyer2@fabrikam.test null", email),
      check("null over a number empties it as well", limit.struck === "2000" && limit.text === "2000 null", limit),
      check("an emptied text is the empty text: two quotes", blank.text === 'Globex ""' || blank.text.endsWith('""'), blank),
      check("the review quotes the text null and shows a plain null for an empty cell", /company eu_cus_002 Fabrikam → null/.test(review) && /email eu_cus_002 buyer2@fabrikam\.test → "null"/.test(review) && /credit_limit eu_cus_002 2000 → null/.test(review), review),
    ]);
    await saveStaged(tab);
    const one = await storedRow(ctx, "customers", "eu_cus_002", "eu");
    const two = await storedRow(ctx, "customers", "eu_cus_003", "eu");
    const byQuery = await queryRow(ctx, "shop", "customers", "eu_cus_002", "eu");
    await ctx.verify("stored", [
      check("company is null, email is the text null, credit_limit is null", one.company === null && one.email === "null" && one.credit_limit === null, one),
      check("the other cells of the row are untouched", one.vip === false || one.vip === true, one.vip),
      check("the emptied text is stored as an empty string", two.company === "", two.company),
      check("the query console reads the same: null and the text null", byQuery?.company === null && byQuery.email === "null", byQuery),
    ]);
    await openEditor(tab, "eu_cus_002", "email");
    const opened = await tab.value({ role: "textbox", name: "Value of email" });
    await tab.press("Enter");
    const unchanged = await reviewLabel(tab);
    await typeInto(tab, "eu_cus_002", "email", "\\\\null");
    await saveStaged(tab);
    const backslash = await storedRow(ctx, "customers", "eu_cus_002", "eu");
    await openEditor(tab, "eu_cus_002", "company");
    const emptyEditor = await tab.value({ role: "textbox", name: "Value of company" });
    await tab.press("Enter");
    const stillNone = await reviewLabel(tab);
    await openEditor(tab, "eu_cus_002", "email");
    const escaped = await tab.value({ role: "textbox", name: "Value of email" });
    await tab.press("Escape");
    await ctx.verify("the text null round-trips", [
      check("the editor opens the text null as \\null", opened === "\\null", opened),
      check("committing it unchanged stages nothing", unchanged === "", unchanged),
      check("\\\\null stores the text \\null", backslash.email === "\\null", backslash.email),
      check("the editor of that text opens it with one more backslash: \\\\null", escaped === "\\\\null", escaped),
      check("an empty cell opens an empty editor and Enter leaves it empty", emptyEditor === "" && stillNone === "", [emptyEditor, stillNone]),
    ]);
  },
};

/**
 * Fills the JSON editor of the open drawer.
 *
 * @param {Tab} tab The tab
 * @param {string} json The text to type
 * @returns {Promise<void>}
 */
async function fillJson(tab, json) {
  await tab.page.getByRole("dialog").getByRole("textbox").fill(json);
}

/**
 * The message under the JSON editor.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The dialog's text
 */
async function drawerContent(tab) {
  return (await tab.page.getByRole("dialog").innerText()).replace(/\s+/g, " ").trim();
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const jsonEditor = {
  id: "object-and-array-cells-open-the-json-editor-in-a-side-drawer",
  title: "an object or array cell opens its JSON in a side drawer, tall as the drawer and as wide as it is resized; Apply stages the value, null empties the cell, Cancel leaves it, a broken text says Invalid JSON and a scalar says it must be a JSON object, an array or null, and the nested values are stored as typed",
  entryPoint: "/modules/database/data JSON editor drawer",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await shopTab(ctx, "products", "eu");
    await openEditor(tab, "eu_sku_lamp", "tags");
    await tab.visible({ role: "dialog", name: "Edit tags" });
    const opened = await drawerContent(tab);
    const dialog = tab.page.getByRole("dialog", { name: "Edit tags" });
    const before = await dialog.boundingBox();
    const editor = await dialog.locator(".cm-editor").boundingBox();
    const handle = await tab.page.getByRole("separator", { name: "Resize the drawer" }).boundingBox();
    if (handle) {
      await tab.page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
      await tab.page.mouse.down();
      await tab.page.mouse.move(handle.x - 160, handle.y + 200);
      await tab.page.mouse.up();
    }
    const after = await settle(() => dialog.boundingBox(), (box) => box !== null && before !== null && box.width > before.width + 100);
    const wideEditor = await dialog.locator(".cm-editor").boundingBox();
    await ctx.verify("the drawer", [
      check("it opens on the column with the cell's JSON, indented", /Edit tags/.test(opened) && /"office"/.test(opened) && /Ln 1/.test(opened), opened),
      check("the editor fills the drawer's height, down to its footer", before !== null && editor !== null && editor.height > before.height * 0.5, [before, editor]),
      check("dragging the drawer's edge widens it, and the editor with it", before !== null && after !== null && wideEditor !== null && editor !== null && after.width > before.width + 100 && wideEditor.width > editor.width + 100, [before, after, editor, wideEditor]),
    ]);
    await fillJson(tab, '{"a":');
    const broken = await settle(() => drawerContent(tab), (content) => /Invalid JSON/.test(content));
    const brokenApply = await tab.enabled({ role: "button", name: "Apply" }, { disabled: true });
    await fillJson(tab, "5");
    const scalar = await settle(() => drawerContent(tab), (content) => /must be a JSON object/.test(content));
    await fillJson(tab, '"text"');
    const text = await settle(() => drawerContent(tab), (content) => /must be a JSON object/.test(content) && /"text"/.test(content));
    const scalarApply = await tab.enabled({ role: "button", name: "Apply" }, { disabled: true });
    await ctx.verify("refused texts", [
      check("a broken text says Invalid JSON with the parser's detail, and Apply is disabled", /Invalid JSON — /.test(broken) && brokenApply.pass, broken),
      check("a number says it must be an object, an array or null", /The value must be a JSON object, an array or null\./.test(scalar), scalar),
      check("a text says it too, and Apply stays disabled", /The value must be a JSON object, an array or null\./.test(text) && scalarApply.pass, text),
    ]);
    await tab.click({ role: "button", name: "Cancel" });
    await tab.visible({ role: "dialog", name: "Edit tags" }, { hidden: true });
    const cancelled = await cellState(tab, "eu_sku_lamp", "tags");
    const cancelledBar = await reviewLabel(tab);
    const cell = await cellOf(tab, "eu_sku_lamp", "tags");
    await cell.dblclick();
    await tab.visible({ role: "dialog", name: "Edit tags" });
    await fillJson(tab, '["a","b",3,true,null,{"k":[1]}]');
    await tab.click({ role: "button", name: "Apply" });
    await tab.visible({ role: "dialog", name: "Edit tags" }, { hidden: true });
    const staged = await cellState(tab, "eu_sku_lamp", "tags");
    await openEditor(tab, "eu_sku_desk", "tags");
    await fillJson(tab, "null");
    await tab.click({ role: "button", name: "Apply" });
    await tab.visible({ role: "dialog", name: "Edit tags" }, { hidden: true });
    const emptied = await cellState(tab, "eu_sku_desk", "tags");
    await ctx.verify("Cancel and Apply", [
      check("Cancel leaves the cell and stages nothing", cancelled.struck === "" && cancelledBar === "", cancelled),
      check("a double-click opens the editor too, and Apply stages an array: size tag [6], old value struck", staged.struck === '["office","bestseller"]' && staged.text.includes('[6] ["a","b",3,true,null,{"k":[1]}]'), staged),
      check("null over an array empties the cell: the old array struck, the null badge", emptied.struck === '["office","bestseller"]' && emptied.text.endsWith("null"), emptied),
    ]);
    await saveStaged(tab);
    const lamp = await storedRow(ctx, "products", "eu_sku_lamp", "eu");
    const desk = await storedRow(ctx, "products", "eu_sku_desk", "eu");
    const byQuery = await queryRow(ctx, "shop", "products", "eu_sku_lamp", "eu");
    await ctx.verify("stored as typed", [
      check("the array is stored whole: strings, a number, a boolean, a null and a nested object", show(lamp.tags) === '["a","b",3,true,null,{"k":[1]}]', lamp.tags),
      check("null empties the cell: the field is null, not an empty array", desk.tags === null, desk.tags),
      check("the query console reads the same array", show(byQuery?.tags) === '["a","b",3,true,null,{"k":[1]}]', byQuery?.tags),
    ]);
    await tab.page.goto(`${tab.page.url().split("/modules")[0]}/modules/database/data?schema=shop&table=orders&instance=eu`);
    await tab.visible({ role: "textbox", name: "Search rows" }, { timeoutMs: 60_000 });
    const nested = '{"carrier":"UPS","eta":"2030-01-01","extra":{"n":[1,2,{"deep":true}],"ok":false,"none":null}}';
    await openEditor(tab, "eu_ord_10401", "shipping");
    await fillJson(tab, nested);
    await tab.click({ role: "button", name: "Apply" });
    await tab.visible({ role: "dialog", name: "Edit shipping" }, { hidden: true });
    await saveStaged(tab);
    const order = await storedRow(ctx, "orders", "eu_ord_10401", "eu");
    await ctx.verify("an object", [check("the nested object replaces the stored one, every type kept", show(order.shipping) === nested, order.shipping)]);
  },
};

export const valueJourneys = guarded([nullAndEscape, jsonEditor]);
