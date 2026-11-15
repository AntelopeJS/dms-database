import { check, db, list, member, pick, show, text } from "../../database.mjs";
import { ALL, browse, rowsOf } from "./browse.mjs";
import { itemField, msg, rowsOfItems } from "./browse-api-kit.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
export const columnsGetAndTables = {
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
      check("the orders columns: the declared ones in declaration order, then the sampled ones in stored order, the instance tag last", show(pick(columns.body, "columns")) === '["_id","number","customer_id","status","created_at","channel","total","currency","coupon_id","shipping","_instance"]', pick(columns.body, "columns")),
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

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
export const referencesCount = {
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
    const summary = (answer) => show(Object.fromEntries(Array.from(list(answer.body, "items").filter((item) => text(item, "schema") !== "links"), (/** @type {unknown} */ item) => [`${text(item, "table")}.${text(item, "field")}`, pick(item, "count")])));
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
export const ownerOnly = {
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

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
export const instancesRoute = {
  id: "the-instance-picker-lists-named-instances-with-a-search-and-a-limit",
  title: "tables/instances lists a schema's named instances sorted, filtered by a case-insensitive search, cut to the limit with the total of matches, and refuses a missing and an unknown schema",
  entryPoint: "GET /api/database/tables/instances",
  async run(/** @type {Ctx} */ ctx) {
    const all = await db(ctx, "shop instances", "GET", "/tables/instances?schema=shop");
    const searched = await db(ctx, "search US", "GET", "/tables/instances?schema=shop&search=US");
    const both = await db(ctx, "search u", "GET", "/tables/instances?schema=shop&search=u");
    const none = await db(ctx, "search zzz", "GET", "/tables/instances?schema=shop&search=zzz");
    const limited = await db(ctx, "limit 1", "GET", "/tables/instances?schema=shop&limit=1");
    const zero = await db(ctx, "limit 0", "GET", "/tables/instances?schema=shop&limit=0");
    const metrics = await db(ctx, "metrics instances", "GET", "/tables/instances?schema=metrics");
    const missing = await db(ctx, "no schema", "GET", "/tables/instances");
    const unknown = await db(ctx, "unknown schema", "GET", "/tables/instances?schema=nowhere");
    await ctx.verify("named instances", [
      check("shop has eu and us, sorted, 2 in total", show(pick(all.body, "instances")) === '["eu","us"]' && pick(all.body, "total") === 2, all.body),
      check("the search ignores case: US finds us only", show(pick(searched.body, "instances")) === '["us"]' && pick(searched.body, "total") === 1, searched.body),
      check("u matches both", pick(both.body, "total") === 2, both.body),
      check("no match: an empty list and 0", show(pick(none.body, "instances")) === "[]" && pick(none.body, "total") === 0, none.body),
      check("limit 1 shows the first instance and still counts 2", show(pick(limited.body, "instances")) === '["eu"]' && pick(limited.body, "total") === 2, limited.body),
      check("limit 0 is raised to 1", show(pick(zero.body, "instances")) === '["eu"]', zero.body),
      check("a schema with no named instance answers none", show(pick(metrics.body, "instances")) === "[]" && pick(metrics.body, "total") === 0, metrics.body),
      check("a missing schema is 400 and an unknown one 404", missing.status === 400 && unknown.status === 404, [missing.status, unknown.status]),
    ]);
  },
};
