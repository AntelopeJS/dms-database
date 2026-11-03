import { check, isRow, parseJson, text } from "../../database.mjs";
import { drawer, facts, openInspector, titledUntil } from "./schema-inspector.mjs";
import { paramsUntil } from "./schema-page.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */
/** @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef */

const SHOP = "?scope=shop&instance=eu";

/**
 * The Columns tab's rows, each as `name | type | null | notes`.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} The rows
 */
export async function columnRows(tab) {
  const cells = await tab.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] table tbody tr')].map((tr) => [...tr.querySelectorAll("td")].map((cell) => cell.innerText.replace(/\s+/g, " ").trim())));
  return cells.map((row) => row.join(" | ").trim());
}

/**
 * Opens one of the inspector's tabs.
 *
 * @param {Tab} tab The tab
 * @param {string} name The tab's name
 * @returns {Promise<void>}
 */
export async function openTab(tab, name) {
  await drawer(tab).getByRole("tab", { name: new RegExp(`^${name}`) }).click();
  await tab.page.waitForTimeout(600);
}

/**
 * The inspector's body text as lines, after the tab list.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} The lines
 */
export async function bodyLines(tab) {
  const body = await drawer(tab).innerText();
  return body.split("\n").map((line) => line.trim().toLowerCase()).filter(Boolean);
}

/** @type {JourneyDef} */
export const factsAndColumns = {
  id: "the-inspector-states-the-counts-and-lists-each-column-with-its-type-null-and-notes",
  title: "the inspector header gives the schema, instance count, rows across instances and the column, index and relation counts in singular and plural, and the Columns tab lists type naming, Null (string | null reads string with yes), and hashed, encrypted and localized notes",
  entryPoint: "/modules/database/schemas?record=",
  async run(ctx) {
    const orders = await openInspector(ctx, `${SHOP}&record=shop::orders`, "orders");
    const header = await facts(orders);
    const link = await drawer(orders).getByRole("link", { name: "Browse by instance in the data browser" }).getAttribute("href");
    const columns = await columnRows(orders);
    await ctx.verify("shop.orders", [
      check("the eyebrow names the schema", header.eyebrow === "schema · shop", header),
      check("it counts the instances", header.instances === "3 instances", header),
      check("rows are counted across every instance", header.rows === "160 rows", header),
      check("the structure counts read plural", header.structure === "10 columns · 3 indexes · 2 relations", header),
      check("a link browses the rows by instance", link === "/modules/database/data?schema=shop&table=orders&instance=all", link),
      check("the tabs carry their counts", (await drawer(orders).getByRole("tab").allTextContents()).map((label) => label.replace(/\s+/g, "")).join() === "Columns10,Indexes3,Relations2,Samplerow", await drawer(orders).getByRole("tab").allTextContents()),
      check("the columns, their types, nulls and notes", JSON.stringify(columns) === JSON.stringify(["_id | primary key | no |", "number | string | no |", "customer_id | customers | no |", "status | string | no |", "created_at | date | no |", "channel | string | no |", "total | number | no |", "currency | string | no |", "coupon_id | string | yes |", "shipping | object | no |"]), columns),
    ]);

    const accounts = await openInspector(ctx, "?record=vault::accounts", "accounts");
    const vault = await facts(accounts);
    const vaultColumns = await columnRows(accounts);
    await ctx.verify("vault.accounts", [
      check("a single instance reads singular", vault.instances === "1 instance" && vault.structure === "5 columns · 1 index · 0 relations", vault),
      check("no rows reads 0 rows and offers no instance browsing", vault.rows === "0 rows" && (await drawer(accounts).getByRole("link", { name: "Browse by instance in the data browser" }).count()) === 0, vault),
      check("hashed, encrypted and localized columns are noted", JSON.stringify(vaultColumns.slice(2)) === JSON.stringify(["password | password | no | Hashed", "card_number | string | no | Encrypted", "display_name | string | no | Localized"]), vaultColumns),
      check("the plain columns have no note", vaultColumns[0] === "_id | primary key | no |" && vaultColumns[1] === "handle | string | no |", vaultColumns),
    ]);

    const single = await openInspector(ctx, "?record=core::entries", "entries");
    const singleFacts = await facts(single);
    await ctx.verify("core.entries", [check("one column reads singular", singleFacts.structure === "1 column · 0 indexes · 0 relations" && singleFacts.rows === "0 rows", singleFacts)]);

    const readings = await openInspector(ctx, "?record=metrics::readings", "readings");
    await ctx.verify("metrics.readings", [check("a thousand rows are grouped", (await facts(readings)).rows === "1,250 rows", await facts(readings))]);

    const products = await openInspector(ctx, `${SHOP}&record=shop::products`, "products");
    const productColumns = await columnRows(products);
    await ctx.verify("shop.products", [check("an array reads as its element type with brackets", productColumns.includes("tags | string[] | no |"), productColumns)]);

    const posts = await openInspector(ctx, "?record=demo::posts", "posts");
    const postsColumns = await columnRows(posts);
    await ctx.verify("demo.posts", [check("a relation column shows the table it points to", postsColumns.includes("tag_ids | tags | no |") && postsColumns.includes("views | number | no |"), postsColumns), check("rows are counted", (await facts(posts)).rows === "3 rows", await facts(posts))]);
  },
};

/** @type {JourneyDef} */
export const quirkColumn = {
  id: "a-column-named-constructor-is-listed-like-any-other-column",
  title: "a table holding a column named constructor opens in the inspector and lists that column with its type, as every other column",
  entryPoint: "/modules/database/schemas?record=quirks::members",
  async run(ctx) {
    const tab = await ctx.tab();
    await tab.signIn("admin");
    await tab.goto("/modules/database/schemas?record=quirks::members");
    const shown = await tab.visible({ role: "dialog", name: "members" });
    const columns = shown.pass ? await columnRows(tab) : [];
    await ctx.verify("the inspector of quirks.members", [
      shown,
      check("constructor is a string column next to _id and note", JSON.stringify(columns) === JSON.stringify(["_id | primary key | no |", "constructor | string | no |", "note | string | no |"]), columns),
    ]);
  },
};

/** @type {JourneyDef} */
export const indexesAndRelations = {
  id: "the-indexes-and-relations-tabs-list-what-the-table-declares-and-a-relation-opens-the-other-table",
  title: "the Indexes tab tells compound from single indexes, the Relations tab lists what the table points to and what points to it with its cardinality, and clicking a relation opens the other table in the same drawer",
  entryPoint: "/modules/database/schemas inspector tabs",
  async run(ctx) {
    const tab = await openInspector(ctx, `${SHOP}&record=shop::orders`, "orders");
    await openTab(tab, "Indexes");
    const indexes = (await bodyLines(tab)).join("|");
    await ctx.verify("shop.orders indexes", [check("single, single and one compound index with its fields", indexes.includes("single|number|single|customer_id|compound|status_created|status|created_at"), indexes)]);
    await openTab(tab, "Relations");
    const relations = (await bodyLines(tab)).join("|");
    await ctx.verify("shop.orders relations", [check("one relation out and one in, N : 1", relations.includes("references · 1|orders.customer_id|customers._id|n : 1|referenced by · 1|order_items.order_id|orders._id|n : 1"), relations)]);

    await tab.click({ role: "button", name: /^orders\.customer_id/, within: { role: "dialog" } });
    const opened = await titledUntil(tab, "customers");
    const followed = await paramsUntil(tab, (query) => query.get("record") === "shop::customers");
    await ctx.verify("a relation opens the table it points to", [
      check("the drawer shows customers, at its place in the list", opened === "Table 3 of 4" && (await facts(tab)).title === "customers", [opened, await facts(tab)]),
      check("the URL follows", followed.get("record") === "shop::customers", tab.page.url()),
    ]);
    const customers = (await bodyLines(tab)).join("|");
    await ctx.verify("shop.customers is pointed at from two schemas", [
      check("it points nowhere and two tables point to it", customers.includes("references · 0|this table points to no other table.|referenced by · 2|orders.customer_id|customers._id|n : 1|links.customer_refs.customer_id|customers._id|n : 1"), customers),
    ]);
    await tab.click({ role: "button", name: /^links\.customer_refs\.customer_id/, within: { role: "dialog" } });
    const other = await titledUntil(tab, "customer_refs");
    const crossed = await paramsUntil(tab, (query) => query.get("record") === "links::customer_refs");
    const refs = (await bodyLines(tab)).join("|");
    await ctx.verify("a relation opens a table of another schema", [
      check("the drawer shows customer_refs, which the filtered list does not hold", other === "" && crossed.get("record") === "links::customer_refs", [other, tab.page.url()]),
      check("its relation names the other schema", refs.includes("customer_refs.customer_id|shop.customers._id|n : 1"), refs),
    ]);

    const posts = await openInspector(ctx, "?record=demo::posts", "posts");
    await openTab(posts, "Relations");
    const many = (await bodyLines(posts)).join("|");
    await ctx.verify("demo.posts", [check("a many relation reads N : N and the comments point to it", many.includes("posts.tag_ids|tags._id|n : n") && many.includes("comments.post|posts._id|n : 1"), many)]);

    const notes = await openInspector(ctx, "?record=vault::plain_notes", "plain_notes");
    await openTab(notes, "Indexes");
    const noIndex = (await bodyLines(notes)).join("|");
    await openTab(notes, "Relations");
    const noRelation = (await bodyLines(notes)).join("|");
    await ctx.verify("empty tabs", [
      check("no index says so", noIndex.includes("no index declared on this table."), noIndex),
      check("no relation says so both ways", noRelation.includes("references · 0|this table points to no other table.|referenced by · 0|no table points to this one."), noRelation),
    ]);
  },
};

/** @type {JourneyDef} */
export const sampleRow = {
  id: "the-sample-row-tab-shows-one-row-and-another-row-pages-through-the-table",
  title: "the Sample row tab shows a row of the table with its instance label (default instance, or the first named instance holding rows), without the instance tag, Another row steps to the next row and wraps, and an empty table says it has no row",
  entryPoint: "/modules/database/schemas inspector Sample row",
  async run(ctx) {
    const code = async (/** @type {Tab} */ tab) => {
      const source = await tab.page.evaluate(() => document.querySelector('[role="dialog"] code')?.textContent ?? "");
      return parseJson(source.trim());
    };
    const label = async (/** @type {Tab} */ tab) => (await bodyLines(tab)).find((line) => line.startsWith("row ")) ?? "";
    const orders = await openInspector(ctx, `${SHOP}&record=shop::orders`, "orders");
    await openTab(orders, "Sample row");
    await orders.page.waitForTimeout(1500);
    const first = await code(orders);
    const firstLabel = await label(orders);
    await ctx.verify("a row of a table whose rows live in named instances", [
      check("the label names the row, the total and the instance", firstLabel === "row 1 of 80 · instance eu", firstLabel),
      check("the row is eu's", text(first, "_id").startsWith("eu_ord_") && text(first, "currency") === "EUR", first),
      check("the instance tag is not shown", !Object.keys(isRow(first) ? first : {}).includes("_instance"), first),
    ]);
    await drawer(orders).getByRole("button", { name: "Another row" }).click();
    await orders.page.waitForTimeout(1500);
    const second = await code(orders);
    await ctx.verify("Another row", [
      check("the label moves to row 2", (await label(orders)) === "row 2 of 80 · instance eu", await label(orders)),
      check("it shows a different row of eu", text(second, "_id") !== text(first, "_id") && text(second, "_id").startsWith("eu_ord_"), [first, second]),
    ]);

    const products = await openInspector(ctx, `${SHOP}&record=shop::products`, "products");
    await openTab(products, "Sample row");
    await products.page.waitForTimeout(1500);
    const ids = [];
    const labels = [await label(products)];
    ids.push(text(await code(products), "_id"));
    for (let step = 1; step <= 6; step += 1) {
      await drawer(products).getByRole("button", { name: "Another row" }).click();
      await products.page.waitForTimeout(1200);
      labels.push(await label(products));
      ids.push(text(await code(products), "_id"));
    }
    await ctx.verify("the default instance and the wrap-around", [
      check("a table with rows in the default instance reads from it", labels[0] === "row 1 of 6 · default instance", labels),
      check("each click moves one row on", labels.slice(0, 6).join() === "row 1 of 6 · default instance,row 2 of 6 · default instance,row 3 of 6 · default instance,row 4 of 6 · default instance,row 5 of 6 · default instance,row 6 of 6 · default instance", labels),
      check("after the last row it starts over", labels[6] === "row 1 of 6 · default instance" && ids[6] === ids[0], [labels[6], ids]),
      check("the six rows differ", new Set(ids.slice(0, 6)).size === 6, ids),
    ]);

    const single = await openInspector(ctx, "?record=vault::plain_notes", "plain_notes");
    await openTab(single, "Sample row");
    await single.page.waitForTimeout(1500);
    const lone = await label(single);
    const disabled = await drawer(single).getByRole("button", { name: "Another row" }).isDisabled();
    await ctx.verify("a table of one row", [check("Row 1 of 1 and Another row disabled", lone === "row 1 of 1 · default instance" && disabled === true, [lone, disabled])]);

    const empty = await openInspector(ctx, "?record=metrics::empty_log", "empty_log");
    await openTab(empty, "Sample row");
    await empty.page.waitForTimeout(1500);
    const lines = (await bodyLines(empty)).join("|");
    await ctx.verify("an empty table", [
      check("it says it has no row yet", lines.includes("this table has no row yet."), lines),
      check("it offers no Another row", (await drawer(empty).getByRole("button", { name: "Another row" }).count()) === 0, lines),
    ]);
    const named = await openInspector(ctx, `${SHOP}&record=shop::customers`, "customers");
    await openTab(named, "Sample row");
    await named.page.waitForTimeout(1500);
    await ctx.verify("a table with no row in the default instance", [check("it reads the first named instance holding rows", (await label(named)) === "row 1 of 24 · instance eu", await label(named))]);
  },
};
