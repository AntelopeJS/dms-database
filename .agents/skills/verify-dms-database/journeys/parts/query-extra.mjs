import { guarded } from "../../guard.mjs";
import { check, list, parseJson, pick, runQuery, tableQuery } from "../../database.mjs";
import { chooseView, editor, exportCsv, flat, openConsole, resultText, runSource } from "./console.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */

/**
 * Parses CSV text with quoted cells, doubled quotes and line breaks inside quotes.
 *
 * @param {string} source The CSV
 * @returns {string[][]} The rows of cells
 */
function parseCsv(source) {
  /** @type {string[][]} */
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (quoted) {
      if (char === '"' && source.charAt(index + 1) === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const INSERT = (/** @type {Record<string, unknown>} */ doc) => ({ stage: "insert", args: [[doc]] });

export const extraJourneys = guarded([
  {
    id: "an-export-of-uneven-rows-keeps-every-key-in-csv-and-json",
    title: "when the first returned row lacks a key that later rows have, Export CSV has a column for every key of every row with each value under its own header, and Copy as JSON holds the same rows",
    entryPoint: "/modules/database/query Export CSV and Copy as JSON",
    async run(/** @type {Ctx} */ ctx) {
      await runQuery(ctx, "insert u1", tableQuery("demo", "tags", [INSERT({ name: "u1" })]));
      await runQuery(ctx, "insert u2", tableQuery("demo", "tags", [INSERT({ name: "u2", extra: "only-here", rank: 7 })]));
      const tab = await openConsole(ctx);
      await tab.page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await runSource(tab, 'schemas.demo.instance().table("tags").orderBy("name")');
      const csv = parseCsv((await exportCsv(tab)).text);
      const header = csv[0] ?? [];
      const byName = (/** @type {string} */ name) => csv.find((row) => row[header.indexOf("name")] === name);
      await tab.page.getByRole("button", { name: "Copy as JSON" }).click();
      await tab.page.waitForTimeout(800);
      const copied = parseJson(await tab.page.evaluate(() => navigator.clipboard.readText()));
      const second = list(copied).find((row) => pick(row, "name") === "u2");
      await ctx.verify("uneven rows", [
        check("the header holds the union of the keys", ["_id", "name", "extra", "rank"].every((key) => header.includes(key)) && header.length === 4, header),
        check("five data rows", csv.length === 6, csv.length),
        check("u2 keeps extra and rank under their own columns", byName("u2")?.[header.indexOf("extra")] === "only-here" && byName("u2")?.[header.indexOf("rank")] === "7", byName("u2")),
        check("u1 and the first row leave them empty", byName("u1")?.[header.indexOf("extra")] === "" && byName("follow-up")?.[header.indexOf("extra")] === "" && byName("follow-up")?.[header.indexOf("rank")] === "", [byName("u1"), byName("follow-up")]),
        check("every row has as many cells as the header", csv.every((row) => row.length === header.length), csv.map((row) => row.length)),
        check("the JSON copy keeps extra and rank on u2", pick(second, "extra") === "only-here" && pick(second, "rank") === 7, second),
      ]);
    },
  },
  {
    id: "csv-quotes-a-comma-a-quote-and-a-line-break-so-the-cell-reads-back",
    title: "a text with a comma, a double quote and a line break exports as one CSV cell that parses back to the same text, next to a plain text and an object value",
    entryPoint: "/modules/database/query Export CSV",
    async run(/** @type {Ctx} */ ctx) {
      const tricky = 'one, two "three"\nfour';
      await runQuery(ctx, "insert tricky", tableQuery("demo", "tags", [INSERT({ name: tricky, plain: "plain", nested: { a: 1 }, nothing: null })]));
      const tab = await openConsole(ctx);
      await runSource(tab, 'schemas.demo.instance().table("tags").filter((row) => row.key("plain").eq("plain"))');
      const exported = await exportCsv(tab);
      const csv = parseCsv(exported.text);
      const header = csv[0] ?? [];
      const row = csv[1] ?? [];
      await ctx.verify("quoting", [
        check("one data row", csv.length === 2, csv),
        check("the text with a comma, quotes and a line break reads back whole", row[header.indexOf("name")] === tricky, row[header.indexOf("name")]),
        check("the raw file quotes it and doubles the quotes", exported.text.includes('"one, two ""three""\nfour"'), exported.text.slice(0, 300)),
        check("a plain text is not quoted", row[header.indexOf("plain")] === "plain" && exported.text.includes(",plain"), row),
        check("an object value is written as its JSON in one cell", row[header.indexOf("nested")] === '{"a":1}', row[header.indexOf("nested")]),
        check("a null is an empty cell and every row has the header's width", row.length === header.length, [row.length, header.length]),
      ]);
    },
  },
  {
    id: "format-strips-trailing-spaces-and-blank-lines",
    title: "Format removes the spaces at the end of a line and the blank lines around a query, leaves a tidy query as it is, and the formatted query still runs",
    entryPoint: "/modules/database/query Format",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      const box = editor(tab);
      const tidyQuery = 'schemas.shop.instance().table("orders").count()';
      const format = async (/** @type {string} */ source, /** @type {number} */ breaks) => {
        await box.fill(source);
        await box.press("Control+End");
        for (let index = 0; index < breaks; index += 1) await box.press("Enter");
        const typed = await box.innerText();
        await tab.page.getByRole("button", { name: "Format", exact: true }).click();
        await tab.page.waitForTimeout(900);
        return { typed, formatted: await box.innerText() };
      };
      const spaced = await format(`${tidyQuery}      `, 0);
      const blank = await format(tidyQuery, 3);
      const tidy = await format(tidyQuery, 0);
      await runSource(tab, tidy.formatted);
      await ctx.verify("Format", [
        check("trailing spaces are removed", spaced.typed !== tidyQuery && spaced.formatted === tidyQuery, spaced),
        check("blank lines after the query are removed", blank.typed !== tidyQuery && blank.typed.startsWith(tidyQuery) && blank.formatted === tidyQuery, blank),
        check("a tidy query is left as it is", tidy.formatted === tidyQuery, tidy),
        check("the formatted query runs", (await resultText(tab)).includes("1 row"), await resultText(tab)),
      ]);
    },
  },
  {
    id: "ctrl-space-inside-a-filter-completes-the-columns-of-the-table",
    title: "Ctrl+Space inside row.key(\" lists every column of the table the query targets and nothing else, with the columns of another table when the table changes",
    entryPoint: "/modules/database/query, Ctrl+Space",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      const box = editor(tab);
      const columnsAfter = async (/** @type {string} */ source) => {
        await box.fill(source);
        await box.press("Control+Space");
        await tab.page.waitForTimeout(1000);
        return (await tab.page.locator(".cm-tooltip-autocomplete li").allTextContents()).map((entry) => entry.replace(/field$/, "")).sort();
      };
      const orders = await columnsAfter('schemas.shop.instance().table("orders").filter((row) => row.key("');
      const readings = await columnsAfter('schemas.metrics.instance().table("readings").filter((row) => row.key("');
      await ctx.verify("column completion", [
        check("the ten columns of shop.orders", JSON.stringify(orders) === JSON.stringify(["_id", "channel", "coupon_id", "created_at", "currency", "customer_id", "number", "shipping", "status", "total"]), orders),
        check("the four columns of metrics.readings", JSON.stringify(readings) === JSON.stringify(["_id", "band", "seq", "value"]), readings),
      ]);
    },
  },
  {
    id: "the-chart-plots-the-first-numeric-column-with-pickers-for-both-axes",
    title: "Chart draws bars of the first numeric column against the first column, and the X and Y pickers change what is plotted",
    entryPoint: "/modules/database/query Chart view",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      await runSource(tab, 'schemas.shop.instance("eu").table("orders").orderBy("number").slice(0, 3)');
      await chooseView(tab, "Chart");
      const controls = async () => (await tab.page.getByRole("combobox").allInnerTexts()).map((entry) => entry.replace(/\s+/g, " ").trim());
      const orders = await controls();
      const text = await resultText(tab);
      await runSource(tab, 'schemas.metrics.instance().table("readings").orderBy("seq").slice(0, 4)');
      const readings = await controls();
      const readingsText = await resultText(tab);
      await tab.page.getByRole("combobox").nth(0).click();
      await tab.page.getByRole("option", { name: "band", exact: true }).click();
      await tab.page.waitForTimeout(600);
      const byBand = flat((await tab.page.locator("body").innerText()).slice(0));
      await ctx.verify("the chart", [
        check("orders: X is the first column and Y the first numeric column, total", JSON.stringify(orders) === JSON.stringify(["x _id", "y total"]), orders),
        check("orders: the three order ids label the bars", ["eu_ord_10400", "eu_ord_10401", "eu_ord_10402"].every((id) => text.includes(id)), text.slice(0, 300)),
        check("readings: Y is seq, the first numeric column, not _id", JSON.stringify(readings) === JSON.stringify(["x _id", "y seq"]), readings),
        check("readings: the four rows are plotted", ["r_0001", "r_0002", "r_0003", "r_0004"].every((id) => readingsText.includes(id)), readingsText.slice(0, 300)),
        check("choosing band for X relabels the bars", byBand.includes("band-1") && byBand.includes("band-4"), byBand.slice(-400)),
      ]);
    },
  },
  {
    id: "open-in-data-browser-opens-the-target-table-or-the-row",
    title: "'Open <table> in data browser' opens the result's target table in its instance, and a row's own link opens the table filtered on that row",
    entryPoint: "/modules/database/query result, /modules/database/data",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      await runSource(tab, 'schemas.shop.instance("eu").table("orders").orderBy("number").slice(0, 3)');
      const header = tab.page.getByRole("link", { name: "Open shop.orders @eu in data browser" });
      const rowLinks = await tab.page.locator('a[href*="match=_id"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      await ctx.verify("the links", [
        check("the header link names the table and its instance", (await header.getAttribute("href")) === "/modules/database/data?schema=shop&table=orders&instance=eu", await header.getAttribute("href")),
        check("each row links to its id", JSON.stringify(rowLinks) === JSON.stringify(["eu_ord_10400", "eu_ord_10401", "eu_ord_10402"].map((id) => `/modules/database/data?schema=shop&table=orders&instance=eu&match=_id%3A${id}`)), rowLinks),
      ]);
      await header.click();
      await tab.visible({ role: "textbox", name: "Search rows" }, { timeoutMs: 60_000 });
      await ctx.verify("the table", [tab.shows(/orders\s+80 rows/, { timeoutMs: 30_000 })]);
      await tab.page.goBack();
      await tab.visible({ role: "heading", name: "Query console", level: 1 }, { timeoutMs: 30_000 });
      await tab.goto("/modules/database/data?schema=shop&table=orders&instance=eu&match=_id%3Aeu_ord_10401");
      await tab.visible({ role: "textbox", name: "Search rows" }, { timeoutMs: 60_000 });
      await ctx.verify("a row link", [tab.shows(/orders\s+1 row\b/, { timeoutMs: 30_000 }), tab.shows(/eu_ord_10401/), tab.shows(/eu_ord_10400/, { not: true })]);
    },
  },
  {
    id: "copy-as-json-puts-the-returned-rows-on-the-clipboard",
    title: "Copy as JSON copies the returned rows, as JSON, and says how many rows were copied",
    entryPoint: "/modules/database/query Copy as JSON",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      await tab.page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await runSource(tab, 'schemas.metrics.instance().table("readings").orderBy("seq").slice(0, 3)');
      await tab.page.getByRole("button", { name: "Copy as JSON" }).click();
      await tab.page.waitForTimeout(800);
      const copied = await tab.page.evaluate(() => navigator.clipboard.readText());
      /** @type {unknown} */
      let rows;
      try {
        rows = JSON.parse(copied);
      } catch {
        rows = undefined;
      }
      const body = flat(await tab.page.locator("body").innerText());
      await ctx.verify("the clipboard", [
        check("a JSON list of the three rows", Array.isArray(rows) && rows.length === 3 && JSON.stringify(rows.map((row) => pick(row, "_id"))) === '["r_0001","r_0002","r_0003"]', copied.slice(0, 200)),
        check("the console says 3 rows copied as JSON", body.includes("3 rows copied as JSON"), body.slice(-300)),
      ]);
    },
  },
]);
