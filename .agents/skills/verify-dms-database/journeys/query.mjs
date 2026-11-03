import { guarded } from "../guard.mjs";
import { check, db, list, text } from "../database.mjs";
import { chooseView, editorText, exportCsv, flat, openConsole, resultText, runSource } from "./parts/console.mjs";

/** @typedef {import("../database.mjs").Ctx} Ctx */

/**
 * The first cell of every body row of the result table.
 *
 * @param {import("../database.mjs").Tab} tab The tab
 * @returns {Promise<string[]>} The ids
 */
async function firstColumn(tab) {
  return tab.page.locator("table tbody tr td:nth-child(1)").allTextContents();
}

/** The console, run and read side. */
export const journeys = guarded([
  {
    id: "a-query-returns-its-rows-in-the-order-it-asks",
    title: "a query chained on shop.products returns the rows the chain selects, in the order orderBy gives, with the row count, a duration, read-only and the target in the result header",
    entryPoint: "/modules/database/query, Ctrl+Enter",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      const ascending = await runSource(tab, 'schemas.shop.instance().table("products").orderBy("price").slice(0, 10)');
      const asc = await firstColumn(tab);
      const header = await resultText(tab);
      await ctx.verify("ascending", [
        check("the six products by price", JSON.stringify(asc) === JSON.stringify(["sku_lamp", "sku_keyboard", "sku_dock", "sku_monitor", "sku_chair", "sku_desk"]), asc),
        check("the header names the rows, the duration, read-only and the target", /^Result 6 rows \d+ ms · read-only · shop\.products\b/.test(header), header.slice(0, 120)),
      ]);
      await runSource(tab, 'schemas.shop.instance().table("products").orderBy("price", "desc").slice(0, 2)');
      const desc = await firstColumn(tab);
      await ctx.verify("descending and sliced", [check("the two dearest, dearest first", JSON.stringify(desc) === JSON.stringify(["sku_desk", "sku_chair"]), desc), check("the ascending run is in the page text only once the new one replaced it", !ascending.includes("2 rows"), "2 rows")]);
      await runSource(tab, 'schemas.shop.instance().table("products").count()', { button: true });
      const count = await resultText(tab);
      await ctx.verify("count, run with the Run button", [check("one row holding 6", /1 row \d+ ms · read-only · shop\.products .*value 6\b/.test(count), count.slice(0, 200))]);
    },
  },
  {
    id: "an-instance-and-every-instance-are-targeted",
    title: "instance() reads the default instance, instance(\"eu\") and instance(\"us\") their own rows, and CROSS_INSTANCE every instance, with the target naming the instance",
    entryPoint: "/modules/database/query",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      const cases = [
        ['schemas.shop.instance().table("orders").count()', /value 0\b/, /shop\.orders\b(?! @)/],
        ['schemas.shop.instance("eu").table("orders").count()', /value 80\b/, /shop\.orders @eu/],
        ['schemas.shop.instance("us").table("orders").count()', /value 80\b/, /shop\.orders @us/],
        ["schemas.shop.instance(CROSS_INSTANCE).table(\"orders\").count()", /value 160\b/, /shop\.orders @\*/],
      ];
      const checks = [];
      for (const [source, rows, target] of cases) {
        await runSource(tab, String(source));
        const result = await resultText(tab);
        checks.push(check(`${source} counts the right rows`, rows.test(result), result.slice(0, 160)), check(`${source} names its target`, target.test(result), result.slice(0, 160)));
      }
      await runSource(tab, 'schemas.shop.instance("eu").table("orders").orderBy("number").slice(0, 2)');
      const eu = await firstColumn(tab);
      await runSource(tab, 'schemas.shop.instance("us").table("orders").orderBy("number").slice(0, 2)');
      const us = await firstColumn(tab);
      checks.push(check("eu rows carry the eu prefix", JSON.stringify(eu) === JSON.stringify(["eu_ord_10400", "eu_ord_10401"]), eu), check("us rows carry the us prefix", JSON.stringify(us) === JSON.stringify(["us_ord_10400", "us_ord_10401"]), us));
      await ctx.verify("the instances", checks);
    },
  },
  {
    id: "a-failed-query-says-what-failed-and-offers-the-nearest-name",
    title: "a syntax error names its line and column, an unknown schema and an unknown table are named with a Replace offer for the closest name, and nothing was changed",
    entryPoint: "/modules/database/query",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      const syntax = await runSource(tab, 'schemas.shop.instance().table("orders"');
      await ctx.verify("syntax", [check("line 1, column 39 with the advice", syntax.includes("Syntax error at line 1, column 39. Check parentheses, quotes and commas."), syntax.slice(-250)), check("nothing was changed and the query was not sent", syntax.includes("Query failed The query was not sent · nothing was changed"), syntax.slice(-250))]);
      const schema = await runSource(tab, 'schemas.nope.instance().table("x")');
      await ctx.verify("unknown schema", [check("the schema is named and the nearest offered", schema.includes("Unknown schema “nope”.") && schema.includes("Replace with “core”"), schema.slice(-200))]);
      const table = await runSource(tab, 'schemas.shop.instance().table("ordres")');
      await ctx.verify("unknown table", [check("the table is named in its schema", table.includes('Unknown table "ordres" in schema shop'), table.slice(-250)), check("a failed run says nothing was changed", /Query failed after \d+ ms · nothing was changed/.test(table), table.slice(-250)), check("the closest table and the schema's tables are offered", table.includes("Replace with “orders”") && table.includes("See shop tables"), table.slice(-250))]);
      await tab.page.getByRole("button", { name: "Replace with “orders”" }).click();
      await tab.page.waitForTimeout(500);
      const replaced = await editorText(tab);
      await ctx.verify("Replace edits the query", [check("the table name is corrected", replaced === 'schemas.shop.instance().table("orders")', replaced)]);
    },
  },
  {
    id: "the-insert-chips-add-their-operation",
    title: "each Insert chip adds its operation at the cursor: table(), filter(), orderBy(), slice(), count() and get(id), with the text the docs name",
    entryPoint: "/modules/database/query",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      const expected = {
        "table()": '.table("")',
        "filter()": '.filter((row) => row.key("").eq(""))',
        "orderBy()": '.orderBy("", "desc")',
        "slice()": ".slice(0, 50)",
        "count()": ".count()",
        "get(id)": '.get("")',
      };
      const checks = [];
      for (const [chip, text] of Object.entries(expected)) {
        await tab.page.getByRole("button", { name: "New", exact: true }).click();
        await tab.page.waitForTimeout(300);
        await tab.page.getByRole("button", { name: chip, exact: true }).click();
        const found = await editorText(tab);
        checks.push(check(`${chip} inserts ${text}`, found === text, found));
      }
      await ctx.verify("the chips", checks);
    },
  },
  {
    id: "ctrl-space-completes-schemas-and-tables-from-the-workspace",
    title: "Ctrl+Space after schemas. lists every registered schema, and inside table(\" the tables of the chosen schema",
    entryPoint: "/modules/database/query, Ctrl+Space",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      const registered = list((await db(ctx, "schemas", "GET", "/schemas")).body, "schemas").map((schema) => text(schema, "id")).sort();
      const editorBox = tab.page.getByRole("textbox", { name: "Query editor (AQL)" });
      await editorBox.fill("schemas.");
      await editorBox.press("Control+Space");
      await tab.page.waitForTimeout(1000);
      const schemas = await tab.page.locator(".cm-tooltip-autocomplete li").allTextContents();
      await editorBox.fill('schemas.shop.instance().table("o');
      await editorBox.press("Control+Space");
      await tab.page.waitForTimeout(1000);
      const tables = await tab.page.locator(".cm-tooltip-autocomplete li").allTextContents();
      await ctx.verify("completions", [
        check("every registered schema, sorted", JSON.stringify(schemas.map((entry) => entry.replace(/schema$/, ""))) === JSON.stringify(registered), [schemas, registered]),
        check("the tables of shop that match o", JSON.stringify(tables.map((entry) => entry.replace(/table$/, ""))) === JSON.stringify(["order_items", "orders"]), tables),
      ]);
    },
  },
  {
    id: "an-empty-console-offers-examples-built-on-your-own-tables",
    title: "an empty console offers two examples on tables of the workspace, and a click fills the editor with the example query, which Run then answers",
    entryPoint: "/modules/database/query",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      const body = flat(await tab.page.locator("body").innerText());
      await ctx.verify("the examples", [check("Run a query to see results and the two examples", body.includes("Run a query to see results") && body.includes("First 10 rows of demo.tags") && body.includes("Count demo.posts"), body.slice(-300))]);
      await tab.page.getByRole("button", { name: "First 10 rows of demo.tags" }).click();
      await tab.page.waitForTimeout(1000);
      const filled = await editorText(tab);
      await runSource(tab, filled, { button: true });
      const first = await resultText(tab);
      await ctx.verify("the first example", [check("its query is in the editor", filled.includes('schemas.demo.instance().table("tags")') && filled.includes("slice(0, 10)"), filled), check("the three tags", /^Result 3 rows \d+ ms · read-only · demo\.tags/.test(first), first.slice(0, 160))]);
      await tab.page.getByRole("button", { name: "New", exact: true }).click();
      await tab.page.waitForTimeout(500);
      await tab.page.getByRole("button", { name: "Count demo.posts" }).click();
      await tab.page.waitForTimeout(1000);
      await runSource(tab, await editorText(tab), { button: true });
      const count = await resultText(tab);
      await ctx.verify("the second example runs", [check("a count of 3", /1 row \d+ ms · read-only · demo\.posts .*value 3\b/.test(count), count.slice(0, 200))]);
    },
  },
  {
    id: "results-over-1000-rows-are-cut-at-1000",
    title: "a run returns at most 1,000 rows: exactly 1,000 are all shown, 1,001 are cut with the total named, and the JSON view and the CSV export hold the 1,000 returned rows",
    entryPoint: "/modules/database/query, metrics.readings (1,250 rows)",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      await runSource(tab, 'schemas.metrics.instance().table("readings").orderBy("seq").slice(0, 1000)');
      const whole = await resultText(tab);
      await ctx.verify("exactly 1,000 rows", [check("the header counts 1,000 rows", whole.startsWith('Result 1,000 rows'), whole.slice(0, 100)), check("no cut of the returned rows is announced", !whole.includes("results are cut") && !whole.includes("Showing 1,000 of"), whole.slice(-300))]);
      await runSource(tab, 'schemas.metrics.instance().table("readings").orderBy("seq").slice(0, 1001)');
      const cut = await resultText(tab);
      await ctx.verify("1,001 rows", [check("the header counts 1,001", cut.startsWith('Result 1,001 rows'), cut.slice(0, 100)), check("the footer names the cut", cut.includes("Showing 1,000 of 1,001 rows: results are cut at 1,000. Add .slice() to page through them."), cut.slice(-300))]);
      await chooseView(tab, "JSON");
      const json = await tab.page.locator("pre, [role='tabpanel'], main").evaluate((node) => node.textContent ?? "");
      const ids = [...json.matchAll(/"_id":\s*"r_(\d{4})"/g)].map((match) => Number(match[1]));
      await ctx.verify("the JSON view", [check("1,000 rows, r_0001 to r_1000", ids.length === 1000 && ids[0] === 1 && ids.at(-1) === 1000, [ids.length, ids[0], ids.at(-1)])]);
      const csv = await exportCsv(tab);
      const lines = csv.text.trim().split("\n");
      await ctx.verify("the CSV export", [
        check("a header and 1,000 rows", lines.length === 1001 && lines[0] === "_id,seq,band,value,_instance", [lines.length, lines[0]]),
        check("the first and the last row", lines[1] === "r_0001,1,band-1,0," && lines.at(-1) === "r_1000,1000,band-5,24,", [lines[1], lines.at(-1)]),
        check("a .csv file", csv.name.endsWith(".csv"), csv.name),
      ]);
    },
  },
  {
    id: "the-table-view-shows-every-returned-row",
    title: "the Table view lists the rows the console returned, up to 1,000, as the docs table says",
    entryPoint: "/modules/database/query, docs 'Table: the rows returned by the console, up to 1,000'",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      await runSource(tab, 'schemas.metrics.instance().table("readings").orderBy("seq").slice(0, 1000)');
      const shown = (await firstColumn(tab)).length;
      await ctx.verify("the table", [check("1,000 rows are listed", shown === 1000, shown)]);
    },
  },
]);
