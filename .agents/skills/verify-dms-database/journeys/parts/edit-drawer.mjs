import { guarded } from "../../guard.mjs";
import { check, show } from "../../database.mjs";
import { browse, openTable, settle } from "./browse.mjs";
import { openRowOf } from "./browse-row.mjs";
import { barStatus, cellState, reviewLabel, saveStaged, storedRow, typeInto } from "./edit.mjs";
import { queryRow } from "./query-wire.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */

/**
 * @param {Tab} tab The tab
 * @param {string} field A column
 * @returns {import("playwright-core").Locator} The row of the drawer's Fields tab
 */
function fieldRow(tab, field) {
  return tab.page.locator(`[data-field-row="${field}"]`);
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The drawer's footer text
 */
async function footerText(tab) {
  return (await tab.page.locator("[data-row-footer]").innerText()).replace(/\s+/g, " ").trim();
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const vault = {
  id: "hashed-encrypted-and-localized-columns-are-written-as-typed",
  title: "the vault's hashed, encrypted and localized columns show their stored text and an edit writes exactly what was typed, bypassing the module's hashing and encryption as the warning says, a multi-line text keeps its lines and the unedited columns stay as stored",
  entryPoint: "/modules/database/data?schema=vault&table=accounts",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await ctx.tab();
    await tab.signIn("admin");
    await openTable(tab, "vault", "accounts");
    await tab.click({ role: "button", name: "_id", exact: true });
    const password = await settle(() => cellState(tab, "acc_ada", "password"), (state) => state.text !== "");
    const card = await cellState(tab, "acc_ada", "card_number");
    await typeInto(tab, "acc_ada", "password", "plain-secret");
    await typeInto(tab, "acc_ada", "card_number", "4242 4242 4242 4242");
    await saveStaged(tab);
    await settle(() => barStatus(tab), (content) => /saved/.test(content));
    const raw = await browse(ctx, "the account", "get", "vault.accounts", { id: "acc_ada" });
    const bob = await browse(ctx, "the other account", "get", "vault.accounts", { id: "acc_bob" });
    await ctx.verify("the grid and the writes", [
      check("the grid shows the stored hash and cipher as text", password.text === "$argon2id$v=19$stored-hash-of-ada" && card.text === "enc:v1:stored-cipher-of-ada", [password.text, card.text]),
      check("the password is stored exactly as typed, not hashed", raw.body !== null && show(raw.body).includes('"password":"plain-secret"'), raw.body),
      check("the card number is stored exactly as typed, not encrypted", show(raw.body).includes('"card_number":"4242 4242 4242 4242"'), raw.body),
      check("the localized name and the handle are untouched", show(raw.body).includes('"handle":"ada"') && show(raw.body).includes("Ada Lovelace, countess of Lovelace"), raw.body),
      check("the other account is untouched", show(bob.body).includes("stored-hash-of-bob"), bob.body),
    ]);
    await openRowOf(tab, "acc_ada");
    const area = fieldRow(tab, "display_name").locator("textarea");
    await area.fill("Line one\nLine two");
    await fieldRow(tab, "handle").locator("input").click();
    const one = await settle(() => footerText(tab), (content) => /1 unsaved change/.test(content));
    await tab.click({ role: "button", name: "Review and save 1 change" });
    await tab.visible({ role: "dialog", name: /^Save/ });
    await tab.click({ role: "button", name: /^Save \d+ changes?$/ });
    await tab.visible({ role: "dialog", name: /^Save/ }, { hidden: true, timeoutMs: 30_000 });
    const multi = await browse(ctx, "the account again", "get", "vault.accounts", { id: "acc_ada" });
    const byQuery = await queryRow(ctx, "vault", "accounts", "acc_ada");
    await ctx.verify("the drawer's text area", [
      check("the drawer stages the long text and its footer counts it", /1 unsaved change/.test(one) && /Review and save 1 change/.test(one), one),
      check("Review and save from the drawer saves it, the two lines kept", show(multi.body).includes('"display_name":"Line one\\nLine two"'), multi.body),
      check("the query console reads the same lines", byQuery?.display_name === "Line one\nLine two", byQuery?.display_name),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const drawerFields = {
  id: "the-row-drawer-stages-edits-like-the-cells-do",
  title: "a field edited in the drawer is staged like a cell: a number, a JSON value and a boolean are checked with the same messages, null is set with the dashed circle, and the drawer's footer and the grid's bar count the same changes",
  entryPoint: "/modules/database/data row drawer, Fields tab",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await ctx.tab();
    await tab.signIn("admin");
    await openTable(tab, "shop", "orders", "eu");
    await tab.click({ role: "button", name: "_id", exact: true });
    await openRowOf(tab, "eu_ord_10402");
    const total = fieldRow(tab, "total").locator("input");
    await total.fill("abc");
    await total.press("Enter");
    const numberError = await settle(async () => (await fieldRow(tab, "total").innerText()).replace(/\s+/g, " "), (content) => /Expected a number/.test(content));
    await total.fill("99.5");
    await total.press("Enter");
    const staged = await settle(() => footerText(tab), (content) => /1 unsaved change/.test(content));
    const shipping = fieldRow(tab, "shipping").locator("textarea");
    await shipping.fill('{"carrier":');
    await fieldRow(tab, "status").locator("input").click();
    const jsonError = await settle(async () => (await fieldRow(tab, "shipping").innerText()).replace(/\s+/g, " "), (content) => /Invalid JSON/.test(content));
    await shipping.fill('{"carrier":"UPS","eta":"2031-01-01"}');
    await fieldRow(tab, "status").locator("input").click();
    await fieldRow(tab, "channel").getByRole("button", { name: "Set to null" }).click();
    const three = await settle(() => footerText(tab), (content) => /3 unsaved changes/.test(content));
    const was = (await fieldRow(tab, "total").innerText()).replace(/\s+/g, " ");
    await tab.click({ role: "button", name: "Close" });
    const bar = await reviewLabel(tab);
    const cell = await cellState(tab, "eu_ord_10402", "total");
    const before = await storedRow(ctx, "orders", "eu_ord_10402", "eu");
    await ctx.verify("staging from the drawer", [
      check("a text in a number field: the number message under it", /Expected a number, e\.g\. 860\.50 · Esc to cancel/.test(numberError), numberError),
      check("a valid number is staged: the footer counts 1 unsaved change", /1 unsaved change/.test(staged), staged),
      check("a broken JSON text says Invalid JSON", /Invalid JSON/.test(jsonError), jsonError),
      check("a fixed JSON text and a nulled field make 3 unsaved changes, the footer offering Review and save 3 changes", /3 unsaved changes/.test(three) && /Review and save 3 changes/.test(three), three),
      check("the field says what it was: was 324 (the stored total)", /was 324/.test(was), was),
      check("the grid's bar shows the same three and the cell the new total", bar === "Review and save 3 changes" && cell.struck === "324" && cell.text === "50 99.5", [bar, cell]),
      check("nothing is written", before.total === 324 && before.channel !== null, [before.total, before.channel]),
    ]);
    await saveStaged(tab);
    const after = await storedRow(ctx, "orders", "eu_ord_10402", "eu");
    await ctx.verify("saved from the drawer's changes", [check("the three changes are stored: 99.5, the object, null", after.total === 99.5 && show(after.shipping) === '{"carrier":"UPS","eta":"2031-01-01"}' && after.channel === null, [after.total, after.shipping, after.channel])]);
  },
};

export const drawerEditJourneys = guarded([vault, drawerFields]);
