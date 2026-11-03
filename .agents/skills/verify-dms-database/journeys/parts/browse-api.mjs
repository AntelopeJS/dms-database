import { guarded } from "../../guard.mjs";
import { check, db, isText, member, pick, show, text } from "../../database.mjs";
import { ALL, browse, ids, rowsOf } from "./browse.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */

/**
 * @param {import("../../database.mjs").Answer} answer An error answer
 * @returns {string} Its message: the body when the body is text, else the message field
 */
function msg(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

/**
 * @param {unknown} items A list of objects
 * @param {number} index The position
 * @param {string} field A field of the item
 * @returns {unknown} The field of the item
 */
function itemField(items, index, field) {
  return Array.isArray(items) ? pick(items[index], field) : undefined;
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const listClampsLimitAndOffset = {
  id: "list-clamps-the-page-and-orders-the-rows",
  title: "browse/list answers 25 rows by default, clamps limit to 1..200 and offset to 0, falls back to ascending for any direction but desc, and answers the exact total",
  entryPoint: "GET /api/database/browse/list",
  async run(/** @type {Ctx} */ ctx) {
    const base = await browse(ctx, "default page", "list", "metrics.readings");
    const cap = await browse(ctx, "limit 500", "list", "metrics.readings", { limit: 500 });
    const exact = await browse(ctx, "limit 200", "list", "metrics.readings", { limit: 200 });
    const below = await browse(ctx, "limit 199", "list", "metrics.readings", { limit: 199 });
    const over = await browse(ctx, "limit 201", "list", "metrics.readings", { limit: 201 });
    const zero = await browse(ctx, "limit 0", "list", "metrics.readings", { limit: 0 });
    const negative = await browse(ctx, "limit -7", "list", "metrics.readings", { limit: -7 });
    const junk = await browse(ctx, "limit abc", "list", "metrics.readings", { limit: "abc" });
    const negativeOffset = await browse(ctx, "offset -3", "list", "metrics.readings", { offset: -3, limit: 5, sortKey: "seq" });
    const last = await browse(ctx, "last page at 200 per page", "list", "metrics.readings", { offset: 1200, limit: 200, sortKey: "seq" });
    const past = await browse(ctx, "past the end", "list", "metrics.readings", { offset: 1250, limit: 25, sortKey: "seq" });
    const asc = await browse(ctx, "seq ascending", "list", "metrics.readings", { sortKey: "seq", limit: 3 });
    const desc = await browse(ctx, "seq descending", "list", "metrics.readings", { sortKey: "seq", sortDirection: "desc", limit: 3 });
    const upper = await browse(ctx, "DESC upper case", "list", "metrics.readings", { sortKey: "seq", sortDirection: "DESC", limit: 3 });
    const upward = await browse(ctx, "direction up", "list", "metrics.readings", { sortKey: "seq", sortDirection: "up", limit: 3 });
    const noKey = await browse(ctx, "direction without key", "list", "metrics.readings", { sortDirection: "desc", limit: 2 });
    const seqs = (/** @type {import("../../database.mjs").Answer} */ answer) => rowsOf(answer).map((row) => row.seq);
    await ctx.verify("the paging parameters", [
      check("no limit answers 25 rows, limit 25, offset 0, total 1250, the primary key", rowsOf(base).length === 25 && pick(base.body, "limit") === 25 && pick(base.body, "offset") === 0 && pick(base.body, "total") === 1250 && pick(base.body, "primaryKey") === "_id", [rowsOf(base).length, pick(base.body, "limit"), pick(base.body, "total"), pick(base.body, "primaryKey")]),
      check("limit 500 is cut to 200 rows and reported as 200", rowsOf(cap).length === 200 && pick(cap.body, "limit") === 200, [rowsOf(cap).length, pick(cap.body, "limit")]),
      check("limit 200 answers 200", rowsOf(exact).length === 200 && pick(exact.body, "limit") === 200, [rowsOf(exact).length, pick(exact.body, "limit")]),
      check("limit 199 answers 199 rows", rowsOf(below).length === 199 && pick(below.body, "limit") === 199, [rowsOf(below).length, pick(below.body, "limit")]),
      check("limit 201 is cut to 200", rowsOf(over).length === 200 && pick(over.body, "limit") === 200, [rowsOf(over).length, pick(over.body, "limit")]),
      check("limit 0 is raised to 1", rowsOf(zero).length === 1 && pick(zero.body, "limit") === 1, [rowsOf(zero).length, pick(zero.body, "limit")]),
      check("a negative limit is raised to 1", rowsOf(negative).length === 1 && pick(negative.body, "limit") === 1, [rowsOf(negative).length, pick(negative.body, "limit")]),
      check("a limit that is not a number falls back to 25", rowsOf(junk).length === 25 && pick(junk.body, "limit") === 25, [rowsOf(junk).length, pick(junk.body, "limit")]),
      check("a negative offset starts at the first row", pick(negativeOffset.body, "offset") === 0 && show(seqs(negativeOffset)) === "[1,2,3,4,5]", seqs(negativeOffset)),
      check("offset 1200 at 200 rows answers the last 50 rows, 1201 to 1250", rowsOf(last).length === 50 && show(seqs(last).slice(0, 1)) === "[1201]" && show(seqs(last).slice(-1)) === "[1250]" && pick(last.body, "total") === 1250, [rowsOf(last).length, seqs(last).slice(0, 1), seqs(last).slice(-1)]),
      check("an offset past the end answers no row and the total", rowsOf(past).length === 0 && pick(past.body, "total") === 1250, [rowsOf(past).length, pick(past.body, "total")]),
      check("ascending by seq starts at 1", show(seqs(asc)) === "[1,2,3]", seqs(asc)),
      check("descending by seq starts at 1250", show(seqs(desc)) === "[1250,1249,1248]", seqs(desc)),
      check("only the word desc sorts descending: DESC and up fall back to ascending", show(seqs(upper)) === "[1,2,3]" && show(seqs(upward)) === "[1,2,3]", [seqs(upper), seqs(upward)]),
      check("a direction without a sort key keeps the stored order", rowsOf(noKey).length === 2 && show(ids(rowsOf(noKey))) === show(ids(rowsOf(base)).slice(0, 2)), [ids(rowsOf(noKey)), ids(rowsOf(base)).slice(0, 2)]),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const listFiltersAndSearch = {
  id: "list-filters-search-and-counts-follow-the-wire-tokens",
  title: "filter_<column> takes is: (exact, case-sensitive), contains: (case-insensitive) or a bare value (exact); an unknown mode or an empty value filters nothing; search matches any cell case-insensitively; filters and search combine and the total counts the matches",
  entryPoint: "GET /api/database/browse/list",
  async run(/** @type {Ctx} */ ctx) {
    const is = await browse(ctx, "band is band-1", "list", "metrics.readings", { filter_band: "is:band-1", limit: 200, sortKey: "seq" });
    const bare = await browse(ctx, "band without a mode", "list", "metrics.readings", { filter_band: "band-1", limit: 1 });
    const upperIs = await browse(ctx, "is is case-sensitive", "list", "metrics.readings", { filter_band: "is:BAND-1", limit: 1 });
    const contains = await browse(ctx, "band contains AND-2", "list", "metrics.readings", { filter_band: "contains:AND-2", limit: 1 });
    const seqIs = await browse(ctx, "seq is 100", "list", "metrics.readings", { filter_seq: "is:100" });
    const seqContains = await browse(ctx, "seq contains 12", "list", "metrics.readings", { filter_seq: "contains:12", limit: 200 });
    const unknownMode = await browse(ctx, "an unknown mode", "list", "metrics.readings", { filter_band: "starts:band", limit: 1 });
    const empty = await browse(ctx, "an empty filter", "list", "metrics.readings", { filter_band: "", limit: 1 });
    const colon = await browse(ctx, "contains with a colon", "list", "metrics.readings", { filter_band: "contains:band-1:x", limit: 1 });
    const search = await browse(ctx, "search BAND-3", "list", "metrics.readings", { search: "BAND-3", limit: 1 });
    const searchId = await browse(ctx, "search an id", "list", "metrics.readings", { search: "R_0042" });
    const searchNumber = await browse(ctx, "search a number", "list", "metrics.readings", { search: "1250", limit: 5 });
    const both = await browse(ctx, "search and filter", "list", "metrics.readings", { search: "band-1", filter_seq: "contains:5", limit: 1 });
    const twoFilters = await browse(ctx, "two filters", "list", "metrics.readings", { filter_band: "is:band-1", filter_seq: "is:1", limit: 5 });
    const sortedFiltered = await browse(ctx, "a filter sorted descending", "list", "metrics.readings", { filter_band: "is:band-2", sortKey: "seq", sortDirection: "desc", limit: 2 });
    const none = await browse(ctx, "no match", "list", "metrics.readings", { search: "zzz-no-such-text" });
    const seqsContaining12 = Array.from({ length: 1250 }, (_, index) => String(index + 1)).filter((seq) => seq.includes("12")).length;
    const bandOne = Array.from({ length: 1250 }, (_, index) => index).filter((index) => index % 5 === 0).length;
    const bandOneWith5 = Array.from({ length: 1250 }, (_, index) => index).filter((index) => index % 5 === 0 && String(index + 1).includes("5")).length;
    await ctx.verify("the filter grammar", [
      check("is:band-1 matches 250 rows, all of band-1", pick(is.body, "total") === 250 && rowsOf(is).length === 200 && rowsOf(is).every((row) => row.band === "band-1"), [pick(is.body, "total"), rowsOf(is).length]),
      check("a bare value is an exact match", pick(bare.body, "total") === 250, pick(bare.body, "total")),
      check("is: is case-sensitive: BAND-1 matches nothing", pick(upperIs.body, "total") === 0, pick(upperIs.body, "total")),
      check("contains: ignores case: AND-2 matches the 250 rows of band-2", pick(contains.body, "total") === 250, pick(contains.body, "total")),
      check("a number cell is compared as its text: is:100 finds one row", pick(seqIs.body, "total") === 1 && rowsOf(seqIs)[0]?.seq === 100, [pick(seqIs.body, "total"), rowsOf(seqIs)[0]?.seq]),
      check(`contains:12 finds the ${seqsContaining12} seq values holding 12`, pick(seqContains.body, "total") === seqsContaining12, [pick(seqContains.body, "total"), seqsContaining12]),
      check("an unknown mode filters nothing", pick(unknownMode.body, "total") === 1250, pick(unknownMode.body, "total")),
      check("an empty value filters nothing", pick(empty.body, "total") === 1250, pick(empty.body, "total")),
      check("only the first colon splits the mode: contains:band-1:x matches nothing", pick(colon.body, "total") === 0, pick(colon.body, "total")),
      check("search ignores case and counts 250 rows", pick(search.body, "total") === 250, pick(search.body, "total")),
      check("search reads the id cell too: R_0042 finds r_0042", pick(searchId.body, "total") === 1 && rowsOf(searchId)[0]?._id === "r_0042", [pick(searchId.body, "total"), rowsOf(searchId)[0]?._id]),
      check("search reads number cells as text: 1250 finds the seq 1250 row", rowsOf(searchNumber).some((row) => row.seq === 1250), ids(rowsOf(searchNumber))),
      check(`search and a filter combine: ${bandOneWith5} rows`, pick(both.body, "total") === bandOneWith5 && bandOneWith5 < bandOne, [pick(both.body, "total"), bandOneWith5]),
      check("two filters both apply", pick(twoFilters.body, "total") === 1 && rowsOf(twoFilters)[0]?.seq === 1, [pick(twoFilters.body, "total"), rowsOf(twoFilters).map((row) => row.seq)]),
      check("a filtered page sorts descending by seq", show(rowsOf(sortedFiltered).map((row) => row.seq)) === "[1247,1242]", rowsOf(sortedFiltered).map((row) => row.seq)),
      check("no match answers no row and a total of 0", rowsOf(none).length === 0 && pick(none.body, "total") === 0, [rowsOf(none).length, pick(none.body, "total")]),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const selectionDecoding = {
  id: "the-selection-decodes-schema-table-and-instance",
  title: "filter_schema, filter_table and filter_instance take is: or a bare value; a missing one answers 400, an unknown schema or table 404; the instance is the default one when absent or empty, a named one, or every instance for the cross-instance token, and any other mode is the default instance",
  entryPoint: "GET /api/database/browse/count, columns, tables, get",
  async run(/** @type {Ctx} */ ctx) {
    const defaultCount = await browse(ctx, "customers in the default instance", "count", "shop.customers");
    const euCount = await browse(ctx, "customers in eu", "count", "shop.customers", { filter_instance: "is:eu" });
    const usCount = await browse(ctx, "customers in us", "count", "shop.customers", { filter_instance: "is:us" });
    const allCount = await browse(ctx, "customers in every instance", "count", "shop.customers", { filter_instance: `is:${ALL}` });
    const emptyInstance = await browse(ctx, "an empty instance", "count", "shop.customers", { filter_instance: "is:" });
    const containsInstance = await browse(ctx, "a contains instance", "count", "shop.customers", { filter_instance: "contains:eu" });
    const bareInstance = await browse(ctx, "a bare instance", "count", "shop.customers", { filter_instance: "eu" });
    const unknownInstance = await browse(ctx, "an unknown instance", "count", "shop.customers", { filter_instance: "is:nowhere" });
    const noSchema = await db(ctx, "no schema", "GET", "/browse/count?filter_table=is:customers");
    const noTable = await db(ctx, "no table", "GET", "/browse/count?filter_schema=is:shop");
    const containsSchema = await db(ctx, "schema in contains mode", "GET", "/browse/count?filter_schema=contains:shop&filter_table=is:customers");
    const bareSchema = await db(ctx, "schema without a mode", "GET", "/browse/count?filter_schema=shop&filter_table=customers&filter_instance=is:eu");
    const unknownSchema = await browse(ctx, "an unknown schema", "count", "nowhere.customers");
    const unknownTable = await browse(ctx, "an unknown table", "count", "shop.nowhere");
    const allRows = await browse(ctx, "every instance's customers", "list", "shop.customers", { filter_instance: `is:${ALL}`, limit: 200, sortKey: "_id" });
    const euRows = await browse(ctx, "eu's customers", "list", "shop.customers", { filter_instance: "is:eu", limit: 3, sortKey: "_id" });
    const instancesOfAll = new Set(rowsOf(allRows).map((row) => row._instance));
    await ctx.verify("the selection", [
      check("the default instance holds no customer", pick(defaultCount.body, "total") === 0, defaultCount.body),
      check("eu holds 24 and us holds 24", pick(euCount.body, "total") === 24 && pick(usCount.body, "total") === 24, [euCount.body, usCount.body]),
      check("the cross-instance token counts 48", pick(allCount.body, "total") === 48, allCount.body),
      check("an empty instance is the default instance", pick(emptyInstance.body, "total") === 0, emptyInstance.body),
      check("only is: selects an instance: contains:eu reads the default one", pick(containsInstance.body, "total") === 0, containsInstance.body),
      check("a bare instance value is exact", pick(bareInstance.body, "total") === 24, bareInstance.body),
      check("an unknown instance is refused or empty, never another instance's rows", unknownInstance.status !== 200 || pick(unknownInstance.body, "total") === 0, [unknownInstance.status, unknownInstance.body]),
      check("a missing schema is 400 and a missing table is 400", noSchema.status === 400 && noTable.status === 400, [noSchema.status, msg(noSchema), noTable.status, msg(noTable)]),
      check("the 400 names the missing filter", /schema/i.test(msg(noSchema)) && /table/i.test(msg(noTable)), [noSchema.body, noTable.body]),
      check("a schema in contains mode is missing: 400", containsSchema.status === 400, containsSchema.status),
      check("a bare schema and table are accepted", bareSchema.status === 200 && pick(bareSchema.body, "total") === 24, [bareSchema.status, bareSchema.body]),
      check("an unknown schema is 404", unknownSchema.status === 404 && /Unknown schema: nowhere/.test(msg(unknownSchema)), [unknownSchema.status, unknownSchema.body]),
      check("an unknown table is 404", unknownTable.status === 404 && /Unknown table: nowhere/.test(msg(unknownTable)), [unknownTable.status, unknownTable.body]),
      check("the cross-instance rows are the rows of eu and of us, tagged with _instance", rowsOf(allRows).length === 48 && instancesOfAll.size === 2 && instancesOfAll.has("eu") && instancesOfAll.has("us"), [rowsOf(allRows).length, [...instancesOfAll]]),
      check("a single instance's rows are tagged with that instance", rowsOf(euRows).length === 3 && rowsOf(euRows).every((row) => row._instance === "eu") && show(ids(rowsOf(euRows))) === '["eu_cus_000","eu_cus_001","eu_cus_002"]', ids(rowsOf(euRows))),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const columnsGetAndTables = {
  id: "columns-get-and-tables-answer-what-the-grid-needs",
  title: "browse/columns answers the sampled columns, their runtime types and the primary key; get answers a row by id; tables answers every table of the schema with its row count in the picked instance",
  entryPoint: "GET /api/database/browse/columns, get, tables",
  async run(/** @type {Ctx} */ ctx) {
    const columns = await browse(ctx, "the columns of eu's orders", "columns", "shop.orders", { filter_instance: "is:eu" });
    const customerColumns = await browse(ctx, "the columns of customers", "columns", "shop.customers", { filter_instance: "is:eu" });
    const emptyColumns = await browse(ctx, "the columns of an empty table", "columns", "metrics.empty_log");
    const row = await browse(ctx, "one order", "get", "shop.orders", { filter_instance: "is:eu", id: "eu_ord_10400" });
    const otherInstance = await browse(ctx, "the same id in us", "get", "shop.orders", { filter_instance: "is:us", id: "eu_ord_10400" });
    const missing = await browse(ctx, "a missing row", "get", "shop.orders", { filter_instance: "is:eu", id: "nope" });
    const noId = await browse(ctx, "no id", "get", "shop.orders", { filter_instance: "is:eu" });
    const tablesEu = await db(ctx, "tables in eu", "GET", "/browse/tables?filter_schema=is:shop&filter_instance=is:eu");
    const tablesDefault = await db(ctx, "tables in the default instance", "GET", "/browse/tables?filter_schema=is:shop");
    const tablesAll = await db(ctx, "tables across every instance", "GET", `/browse/tables?filter_schema=is:shop&filter_instance=is:${ALL}`);
    const tablesMetrics = await db(ctx, "tables of metrics", "GET", "/browse/tables?filter_schema=is:metrics");
    const noSchema = await db(ctx, "tables without a schema", "GET", "/browse/tables");
    const unknown = await db(ctx, "tables of an unknown schema", "GET", "/browse/tables?filter_schema=is:nowhere");
    /** @param {import("../../database.mjs").Answer} answer @returns {string} */
    const counts = (answer) => show(Object.fromEntries(rowsOfItems(answer).map((item) => [item.name, item.elementCount])));
    const types = pick(columns.body, "types");
    await ctx.verify("the grid's reads", [
      check("the orders columns, in the stored order, with the instance tag last", show(pick(columns.body, "columns")) === '["_id","number","customer_id","status","channel","total","currency","coupon_id","shipping","created_at","_instance"]', pick(columns.body, "columns")),
      check("the primary key is _id", pick(columns.body, "primaryKey") === "_id", pick(columns.body, "primaryKey")),
      check("the types name the runtime type of each column", show(types) !== "undefined" && pick(types, "total") === "number" && pick(types, "status") === "string" && pick(types, "shipping") === "object" && pick(types, "created_at") === "date", types),
      check("a null cell takes the type of a later row: coupon_id is a string", pick(types, "coupon_id") === "string", pick(types, "coupon_id")),
      check("customers: a boolean and a number column", pick(customerColumns.body, "types", "vip") === "boolean" && pick(customerColumns.body, "types", "credit_limit") === "number", pick(customerColumns.body, "types")),
      check("an empty table has no sampled column", show(pick(emptyColumns.body, "columns")) === "[]", emptyColumns.body),
      check("get answers the stored row", pick(row.body, "_id") === "eu_ord_10400" && pick(row.body, "number") === "#10400" && pick(row.body, "customer_id") === "eu_cus_000" && pick(row.body, "shipping", "carrier") === "DHL", row.body),
      check("get reads the instance asked: the id of eu is not in us", otherInstance.status === 404 && /Row not found/.test(msg(otherInstance)), [otherInstance.status, otherInstance.body]),
      check("get of a missing id is 404, without an id 400", missing.status === 404 && noId.status === 400, [missing.status, noId.status]),
      check("tables of eu: 24 customers, 6 products, 80 orders, 160 order_items", counts(tablesEu) === '{"customers":24,"products":6,"orders":80,"order_items":160}', counts(tablesEu)),
      check("tables of the default instance: only products hold rows", counts(tablesDefault) === '{"customers":0,"products":6,"orders":0,"order_items":0}', counts(tablesDefault)),
      check("tables across every instance count the union", counts(tablesAll) === '{"customers":48,"products":18,"orders":160,"order_items":320}', counts(tablesAll)),
      check("metrics: 1250 readings and an empty log", counts(tablesMetrics) === '{"readings":1250,"empty_log":0}', counts(tablesMetrics)),
      check("tables without a schema is 400, an unknown schema 404", noSchema.status === 400 && unknown.status === 404 && /Unknown schema: nowhere/.test(msg(unknown)), [noSchema.status, unknown.status]),
    ]);
  },
};

/**
 * @param {import("../../database.mjs").Answer} answer A tables answer
 * @returns {{ name: unknown, elementCount: unknown }[]} Its items
 */
function rowsOfItems(answer) {
  const items = pick(answer.body, "items");
  return Array.isArray(items) ? items.map((item) => ({ name: pick(item, "name"), elementCount: pick(item, "elementCount") })) : [];
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const referencesCount = {
  id: "references-count-the-rows-pointing-at-a-row",
  title: "browse/references counts, per relation column, the rows of other tables pointing at one row in the same instance, answers an empty list for a table nothing points to, and refuses every instance, a missing id and a missing row",
  entryPoint: "GET /api/database/browse/references",
  async run(/** @type {Ctx} */ ctx) {
    const order = await browse(ctx, "what points at an order", "references", "shop.orders", { filter_instance: "is:eu", id: "eu_ord_10400" });
    const customer = await browse(ctx, "what points at a customer", "references", "shop.customers", { filter_instance: "is:eu", id: "eu_cus_000" });
    const customerUs = await browse(ctx, "the same customer number in us", "references", "shop.customers", { filter_instance: "is:us", id: "us_cus_001" });
    const product = await browse(ctx, "what points at a product", "references", "shop.products", { filter_instance: "is:eu", id: "eu_sku_desk" });
    const defaultProduct = await browse(ctx, "what points at a default product", "references", "shop.products", { id: "sku_desk" });
    const items = await browse(ctx, "what points at an order item", "references", "shop.order_items", { filter_instance: "is:eu", id: "eu_itm_0" });
    const everywhere = await browse(ctx, "every instance", "references", "shop.orders", { filter_instance: `is:${ALL}`, id: "eu_ord_10400" });
    const noId = await browse(ctx, "no id", "references", "shop.orders", { filter_instance: "is:eu" });
    const missing = await browse(ctx, "a missing row", "references", "shop.orders", { filter_instance: "is:eu", id: "nope" });
    const tags = await browse(ctx, "what points at a tag", "references", "demo.tags", { id: "none" });
    const posts = await browse(ctx, "what points at a post", "references", "demo.posts", { id: "none" });
    const demoRows = await browse(ctx, "a tag id", "list", "demo.tags", { sortKey: "name", limit: 1 });
    const tagId = String(rowsOf(demoRows)[0]?._id);
    const postRows = await browse(ctx, "a post", "list", "demo.posts", { sortKey: "title", limit: 1 });
    const postId = String(rowsOf(postRows)[0]?._id);
    const postRefs = await browse(ctx, "what points at the first post", "references", "demo.posts", { id: postId });
    const tagRefs = await browse(ctx, "what points at the first tag", "references", "demo.tags", { id: tagId });
    /** @param {import("../../database.mjs").Answer} answer @returns {string} */
    const summary = (answer) => show(Object.fromEntries(Array.from(pick(answer.body, "items") ?? [], (/** @type {unknown} */ item) => [`${text(item, "table")}.${text(item, "field")}`, pick(item, "count")])));
    await ctx.verify("the references", [
      check("an order is pointed at by two order_items.order_id, not many", summary(order) === '{"order_items.order_id":2}' && itemField(pick(order.body, "items"), 0, "many") === false, order.body),
      check("a customer: its 4 orders in eu", summary(customer) === '{"orders.customer_id":4}', customer.body),
      check("us counts in us, not in eu", summary(customerUs) === '{"orders.customer_id":4}', customerUs.body),
      check("an eu product counts the order items of eu only: 27", summary(product) === '{"order_items.product_id":27}', product.body),
      check("the same product in the default instance counts the default instance: 0", summary(defaultProduct) === '{"order_items.product_id":0}', defaultProduct.body),
      check("a table nothing points to answers an empty list", show(pick(items.body, "items")) === "[]", items.body),
      check("every instance is refused 400", everywhere.status === 400 && /Pick one instance/.test(msg(everywhere)), [everywhere.status, everywhere.body]),
      check("a missing id is 400 and a missing row 404", noId.status === 400 && missing.status === 404, [noId.status, missing.status]),
      check("an unknown row of demo is 404", tags.status === 404 && posts.status === 404, [tags.status, posts.status]),
      check("a many relation (posts.tag_ids -> tags) is counted with includes: 0 rows today", summary(tagRefs).includes("posts.tag_ids") && itemField(pick(tagRefs.body, "items"), 0, "many") === true, tagRefs.body),
      check("a post is pointed at by comments.post", summary(postRefs).includes("comments.post"), postRefs.body),
    ]);
  },
};

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const ownerOnly = {
  id: "the-browse-api-answers-the-platform-owner-only",
  title: "an anonymous caller and a member without the owner's rights are refused every browse route, edits included, and nothing is written",
  entryPoint: "/api/database/browse/*",
  async run(/** @type {Ctx} */ ctx) {
    await member(ctx, "reader", []);
    const paths = ["/browse/list?filter_schema=is:shop&filter_table=is:products", "/browse/count?filter_schema=is:shop&filter_table=is:products", "/browse/columns?filter_schema=is:shop&filter_table=is:products", "/browse/tables?filter_schema=is:shop", "/browse/get?filter_schema=is:shop&filter_table=is:products&id=sku_desk", "/browse/references?filter_schema=is:shop&filter_table=is:products&id=sku_desk", "/tables/instances?schema=shop"];
    const anon = [];
    const reader = [];
    for (const path of paths) {
      anon.push((await db(ctx, `anonymous ${path}`, "GET", path, { as: "anon" })).status);
      reader.push((await db(ctx, `member ${path}`, "GET", path, { as: "reader" })).status);
    }
    const edit = "/browse/edit?filter_schema=is:shop&filter_table=is:products&id=sku_desk";
    const anonEdit = await db(ctx, "anonymous edit", "PUT", edit, { as: "anon", body: { name: "Hacked" } });
    const readerEdit = await db(ctx, "member edit", "PUT", edit, { as: "reader", body: { name: "Hacked" } });
    const after = await browse(ctx, "the product after", "get", "shop.products", { id: "sku_desk" });
    await ctx.verify("who may browse", [
      check("anonymous: 401 on every read route", anon.every((status) => status === 401), anon),
      check("a member without the owner's rights: refused on every read route", reader.every((status) => status === 403), reader),
      check("anonymous and member edits are refused", anonEdit.status === 401 && readerEdit.status === 403, [anonEdit.status, readerEdit.status]),
      check("the product is untouched", pick(after.body, "name") === "Standing desk", after.body),
    ]);
  },
};

export const browseApiJourneys = guarded([listClampsLimitAndOffset, listFiltersAndSearch, selectionDecoding, columnsGetAndTables, referencesCount, ownerOnly]);
