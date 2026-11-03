import { guarded } from "../../guard.mjs";
import { check, db, pick, show } from "../../database.mjs";
import { browse, openTable, rowsOf, settle } from "./browse.mjs";
import { cellOf, cellState, saveStaged, savedNotice, storedRow, typeInto } from "./edit.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */

/**
 * @param {Ctx} ctx The journey
 * @param {string} schema The schema
 * @param {string} table The table
 * @param {string} [instance] The instance
 * @returns {Promise<Tab>} A signed-in tab on the table
 */
async function tabOn(ctx, schema, table, instance) {
  const tab = await ctx.tab();
  await tab.signIn("admin");
  await openTable(tab, schema, table, instance);
  return tab;
}

/**
 * The stored name or company of the rows of one table in the three instances.
 *
 * @param {Ctx} ctx The journey
 * @param {string} table The table
 * @param {string} field The field
 * @param {[string | undefined, string][]} rows The instance and id of each row
 * @returns {Promise<string[]>} The stored values, in order
 */
async function stored(ctx, table, field, rows) {
  const reads = [];
  for (const [instance, id] of rows) {
    const row = await storedRow(ctx, table, id, instance);
    reads.push(String(row[field]));
  }
  return reads;
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const instances = {
  id: "an-edit-and-its-undo-land-in-the-instance-of-the-tab-only",
  title: "a save and its Undo change the row of the instance the tab browses and no row of the other instances, whose ids differ per instance on a shared collection, and the review names the instance",
  entryPoint: "PUT /api/database/browse/edit with filter_instance",
  async run(/** @type {Ctx} */ ctx) {
    /** @type {[string | undefined, string][]} */
    const customers = [["eu", "eu_cus_005"], ["us", "us_cus_005"]];
    /** @type {[string | undefined, string][]} */
    const lamps = [[undefined, "sku_lamp"], ["eu", "eu_sku_lamp"], ["us", "us_sku_lamp"]];
    const initial = await stored(ctx, "customers", "company", customers);
    const tab = await tabOn(ctx, "shop", "customers", "eu");
    await typeInto(tab, "eu_cus_005", "company", "EU Co");
    await tab.press("Control+s");
    await tab.visible({ role: "dialog", name: /^Save/ });
    const review = (await tab.page.getByRole("dialog").innerText()).replace(/\s+/g, " ");
    await tab.click({ role: "button", name: /^Save \d+ changes?$/ });
    await settle(() => savedNotice(tab), (content) => /saved/.test(content));
    const afterEu = await stored(ctx, "customers", "company", customers);
    const us = await tabOn(ctx, "shop", "customers", "us");
    await typeInto(us, "us_cus_005", "company", "US Co");
    const usReview = await saveStaged(us);
    const afterUs = await stored(ctx, "customers", "company", customers);
    await us.click({ role: "button", name: "Undo" });
    await settle(() => savedNotice(us), (content) => /undone/.test(content));
    const afterUndo = await stored(ctx, "customers", "company", customers);
    const base = await tabOn(ctx, "shop", "products");
    await typeInto(base, "sku_lamp", "name", "Default lamp");
    const baseReview = await saveStaged(base);
    const afterDefault = await stored(ctx, "products", "name", lamps);
    await ctx.verify("one instance at a time", [
      check("the two customers start with their own companies, neither of the new ones", initial[0] === "Umbrella" && initial[1] === "Umbrella", initial),
      check("the review names shop.customers @eu", /It is written to shop\.customers @eu\./.test(review), review),
      check("saving in eu changes the eu row only", afterEu[0] === "EU Co" && afterEu[1] === initial[1], afterEu),
      check("the review of the us tab names @us", /shop\.customers @us/.test(usReview), usReview),
      check("saving in us changes the us row only", afterUs[0] === "EU Co" && afterUs[1] === "US Co", afterUs),
      check("Undo in us restores the us row and leaves the eu row as saved", afterUndo[0] === "EU Co" && afterUndo[1] === initial[1], afterUndo),
      check("saving in the default instance changes its lamp only and names @default", afterDefault[0] === "Default lamp" && afterDefault[1] === "Desk lamp" && afterDefault[2] === "Desk lamp" && /shop\.products @default/.test(baseReview), [afterDefault, baseReview]),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const typedValues = {
  id: "saved-cells-keep-their-type-numbers-booleans-dates-and-objects",
  title: "cells typed in the browser are stored as numbers, booleans, dates and nested JSON, never as text: the column types the API infers from the stored rows stay number, boolean, date and object after the edit",
  entryPoint: "/modules/database/data cells saved into shop.orders and shop.customers",
  async run(/** @type {Ctx} */ ctx) {
    const orders = await browse(ctx, "the first order", "list", "shop.orders", { filter_instance: "is:eu", limit: 1 });
    const customers = await browse(ctx, "the first customer", "list", "shop.customers", { filter_instance: "is:eu", limit: 1 });
    const firstOrder = String(rowsOf(orders)[0]?._id);
    const firstCustomer = String(rowsOf(customers)[0]?._id);
    const tab = await tabOn(ctx, "shop", "orders", "eu");
    await typeInto(tab, firstOrder, "total", "860.50");
    await typeInto(tab, firstOrder, "created_at", "2026-10-09");
    await saveStaged(tab);
    await settle(() => savedNotice(tab), (content) => /saved/.test(content));
    const ordersColumns = await browse(ctx, "order column types", "columns", "shop.orders", { filter_instance: "is:eu" });
    const order = await storedRow(ctx, "orders", firstOrder, "eu");
    const customerTab = await tabOn(ctx, "shop", "customers", "eu");
    await typeInto(customerTab, firstCustomer, "credit_limit", "1e3");
    const vipBefore = (await cellState(customerTab, firstCustomer, "vip")).text;
    const vipFlipped = vipBefore === "true" ? "false" : "true";
    await (await cellOf(customerTab, firstCustomer, "vip")).dblclick();
    await customerTab.select({ role: "combobox", name: "Value of vip" }, vipFlipped);
    const vip = await settle(() => cellState(customerTab, firstCustomer, "vip"), (state) => state.struck !== "");
    await saveStaged(customerTab);
    await settle(() => savedNotice(customerTab), (content) => /saved/.test(content));
    const customerColumns = await browse(ctx, "customer column types", "columns", "shop.customers", { filter_instance: "is:eu" });
    const customer = await storedRow(ctx, "customers", firstCustomer, "eu");
    await ctx.verify("types after the edit", [
      check("the edited total is the number 860.5 and the column is still number", order.total === 860.5 && pick(ordersColumns.body, "types", "total") === "number", [order.total, pick(ordersColumns.body, "types", "total")]),
      check("the edited date is stored as a date: the column type is date and the value an ISO instant", order.created_at === "2026-10-09T00:00:00.000Z" && pick(ordersColumns.body, "types", "created_at") === "date", [order.created_at, pick(ordersColumns.body, "types", "created_at")]),
      check("1e3 is stored as the number 1000", customer.credit_limit === 1000 && pick(customerColumns.body, "types", "credit_limit") === "number", [customer.credit_limit, pick(customerColumns.body, "types", "credit_limit")]),
      check("the vip boolean flipped through its select is stored as a boolean", customer.vip === (vipFlipped === "true") && pick(customerColumns.body, "types", "vip") === "boolean" && vip.struck === vipBefore, [customer.vip, pick(customerColumns.body, "types", "vip")]),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const editRoute = {
  id: "the-edit-route-writes-typed-values-and-refuses-the-rest",
  title: "PUT /browse/edit writes the fields it is given as typed, keeps a date a date and refuses a value that is no date with 400, never rewrites the primary key or _instance, replaces an object whole, clears with null, answers the merged row, and refuses a missing id, a non-object body and a missing row",
  entryPoint: "PUT /api/database/browse/edit",
  async run(/** @type {Ctx} */ ctx) {
    const query = "filter_schema=is:shop&filter_table=is:orders&filter_instance=is:eu";
    const put = (/** @type {string} */ label, /** @type {string} */ id, /** @type {unknown} */ body) => db(ctx, label, "PUT", `/browse/edit?${query}${id ? `&id=${id}` : ""}`, { body });
    const id = "eu_ord_10405";
    const number = await put("a number", id, { total: 12.5 });
    const textOverNumber = await put("a text over a number", id, { channel: "kiosk", currency: "GBP" });
    const dateText = await put("a date as text", id, { created_at: "2026-10-09" });
    const badDate = await put("no date", id, { created_at: "not a date" });
    const boolDate = await put("a boolean over a date", id, { created_at: true });
    const key = await put("the primary key", id, { _id: "hacked", _instance: "us" });
    const object = await put("an object", id, { shipping: { carrier: "X" } });
    const cleared = await put("null", id, { coupon_id: null, channel: null });
    const added = await put("a new field", id, { gift: true, note: "hello" });
    const same = await put("an unchanged echo", id, { currency: "GBP", gift: true });
    const noId = await put("no id", "", { total: 1 });
    const array = await put("an array body", id, [1, 2]);
    const missing = await put("a missing row", "nope", { total: 1 });
    const stored = await storedRow(ctx, "orders", id, "eu");
    const hacked = await browse(ctx, "the hacked id", "get", "shop.orders", { filter_instance: "is:eu", id: "hacked" });
    const types = await browse(ctx, "order column types", "columns", "shop.orders", { filter_instance: "is:eu" });
    await ctx.verify("the writes", [
      check("a number is stored as a number and answered merged", number.status === 200 && pick(number.body, "total") === 12.5 && pick(number.body, "number") === "#10405", number.body),
      check("two text fields are written in one call", textOverNumber.status === 200 && pick(textOverNumber.body, "currency") === "GBP", textOverNumber.body),
      check("a date cell takes a date text and stays a date: the column type is date", dateText.status === 200 && stored.created_at === "2026-10-09T00:00:00.000Z" && pick(types.body, "types", "created_at") === "date", [stored.created_at, pick(types.body, "types", "created_at")]),
      check("a text that is no date is refused 400 naming the field", badDate.status === 400 && /Invalid date for 'created_at'/.test(String(badDate.body)), [badDate.status, badDate.body]),
      check("a boolean over a date is refused 400", boolDate.status === 400, boolDate.status),
      check("the primary key and _instance are never rewritten: the answer is the same row", key.status === 200 && stored._id === id && stored._instance === "eu" && hacked.status === 404, [key.status, stored._id, stored._instance, hacked.status]),
      check("an object replaces the stored one whole", object.status === 200 && show(stored.shipping) === '{"carrier":"X"}', stored.shipping),
      check("null clears a cell: coupon_id and channel are null", cleared.status === 200 && stored.coupon_id === null && stored.channel === null, [stored.coupon_id, stored.channel]),
      check("a field the row never had is added, as typed", added.status === 200 && stored.gift === true && stored.note === "hello", [stored.gift, stored.note]),
      check("an unchanged echo is accepted and changes nothing", same.status === 200 && stored.currency === "GBP", same.status),
      check("a missing id is 400, an array body is 400, a missing row is 404", noId.status === 400 && array.status === 400 && missing.status === 404 && /Row not found/.test(String(missing.body)), [noId.status, array.status, missing.status]),
    ]);
  },
};

export const storeJourneys = guarded([instances, typedValues, editRoute]);
