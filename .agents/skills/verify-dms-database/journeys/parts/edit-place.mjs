import { guarded } from "../../guard.mjs";
import { check, db } from "../../database.mjs";
import { addFilter, columnValues, filterChips, openTable, settle, toolbarCount } from "./browse.mjs";
import { savedNotice, saveStaged, typeInto } from "./edit.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */

/**
 * Another writer changes a field of a product of eu behind the browser's back.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The product
 * @param {Record<string, string | number>} body The fields
 * @returns {Promise<void>}
 */
async function elsewhere(ctx, id, body) {
  await db(ctx, `another writer changes ${id}`, "PUT", `/browse/edit?filter_schema=is:shop&filter_table=is:products&filter_instance=is:eu&id=${id}`, { body });
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<Tab>} A signed-in tab on eu's products
 */
async function products(ctx) {
  const tab = await ctx.tab();
  await tab.signIn("admin");
  await openTable(tab, "shop", "products", "eu");
  await settle(() => columnValues(tab, "name"), (values) => values.length === 6);
  return tab;
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const inPlace = {
  id: "a-saved-row-shows-in-place-unless-the-save-may-move-rows",
  title: "a saved row shows as the server answered it without reading the page again, so another writer's change on a neighbouring row stays unseen, until the save touches the sorted field, a filtered field or a search is active, which read the page again",
  entryPoint: "README: a saved row shows in place; the page is read again when a save may move rows",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await products(ctx);
    await elsewhere(ctx, "eu_sku_desk", { price: 1 });
    await typeInto(tab, "eu_sku_lamp", "name", "Reading lamp");
    await saveStaged(tab);
    await settle(() => savedNotice(tab), (content) => /saved/.test(content));
    const plain = await columnValues(tab, "price");
    const plainNames = await columnValues(tab, "name");
    await ctx.verify("no sort, no filter, no search", [
      check("the saved row shows its new name at once", plainNames.includes("Reading lamp"), plainNames),
      check("the page was not read again: the desk still shows its old price 640, not the other writer's 1", plain.includes("640") && !plain.includes("1"), plain),
    ]);
    await tab.click({ role: "button", name: "price", exact: true });
    await settle(() => columnValues(tab, "price"), (values) => values[0] === "48" || values[0] === "1");
    const sortedOnPrice = await columnValues(tab, "price");
    await elsewhere(ctx, "eu_sku_chair", { price: 2 });
    await typeInto(tab, "eu_sku_lamp", "name", "Floor lamp");
    await saveStaged(tab);
    await settle(() => savedNotice(tab), (content) => /saved/.test(content));
    const otherField = await columnValues(tab, "price");
    await ctx.verify("sorted by another field", [
      check("the page is sorted by price: 1 (the desk, read once the sort was applied) first", sortedOnPrice[0] === "1", sortedOnPrice),
      check("saving the name does not read the page again: the chair still shows 320", otherField.includes("320") && !otherField.includes("2"), otherField),
    ]);
    await elsewhere(ctx, "eu_sku_keyboard", { price: 3 });
    await typeInto(tab, "eu_sku_lamp", "price", "0.5");
    await saveStaged(tab);
    await settle(() => savedNotice(tab), (content) => /saved/.test(content));
    const sortedField = await settle(() => columnValues(tab, "price"), (values) => values[0] === "0.5");
    await ctx.verify("the sorted field", [
      check("saving the sorted field reads the page again: the lamp moves first at 0.5", sortedField[0] === "0.5", sortedField),
      check("and the chair's and keyboard's changes by other writers now show", sortedField.includes("2") && sortedField.includes("3"), sortedField),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const refined = {
  id: "a-save-under-a-search-or-a-filter-reads-the-page-again",
  title: "with a search every save reads the page again and a row that no longer matches leaves it, with a filter only a save of the filtered field does",
  entryPoint: "README: a saved row shows in place; the page is read again when a save may move rows",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await products(ctx);
    await addFilter(tab, "name", "contains", "desk");
    await settle(() => toolbarCount(tab), (content) => content === "2 rows");
    const chips = await filterChips(tab);
    await elsewhere(ctx, "eu_sku_desk", { price: 1 });
    await typeInto(tab, "eu_sku_lamp", "price", "49");
    await saveStaged(tab);
    await settle(() => savedNotice(tab), (content) => /saved/.test(content));
    const unfilteredField = await columnValues(tab, "price");
    await typeInto(tab, "eu_sku_lamp", "name", "Lantern");
    await saveStaged(tab);
    const reread = await settle(() => columnValues(tab, "name"), (values) => values.length === 1);
    const price = await columnValues(tab, "price");
    await ctx.verify("a filter on name", [
      check("the chip names the filter", chips.join() === "name contains desk", chips),
      check("saving the price does not read the page: the desk shows 640, not the other writer's 1", unfilteredField.includes("640") && unfilteredField.includes("49") && !unfilteredField.includes("1"), unfilteredField),
      check("saving the name reads the page again: the lantern no longer matches and leaves, the desk shows 1", reread.join() === "Standing desk" && price.join() === "1", [reread, price]),
    ]);
    await tab.click({ role: "button", name: "Clear all" });
    await settle(() => columnValues(tab, "name"), (values) => values.length === 6);
    await tab.fill({ role: "textbox", name: "Search rows" }, "chair");
    await settle(() => columnValues(tab, "name"), (values) => values.length === 1);
    await elsewhere(ctx, "eu_sku_monitor", { price: 5 });
    await typeInto(tab, "eu_sku_chair", "price", "321");
    await saveStaged(tab);
    await settle(() => savedNotice(tab), (content) => /saved/.test(content));
    const afterSearch = await columnValues(tab, "price");
    await tab.fill({ role: "textbox", name: "Search rows" }, "");
    const all = await settle(() => columnValues(tab, "price"), (values) => values.length === 6);
    await typeInto(tab, "eu_sku_chair", "name", "Stool");
    await tab.fill({ role: "textbox", name: "Search rows" }, "chair");
    await settle(() => columnValues(tab, "name"), (values) => values.length === 1);
    await saveStaged(tab);
    const vanished = await settle(() => columnValues(tab, "name"), (values) => values.length === 0);
    await ctx.verify("a search", [
      check("with a search active a save of any field reads the page again", afterSearch.join() === "321", afterSearch),
      check("the full page afterwards holds the monitor's price 5 written by the other writer", all.includes("5"), all),
      check("a renamed row no longer matching the search leaves the page", vanished.length === 0, vanished),
    ]);
  },
};

export const placeJourneys = guarded([inPlace, refined]);
