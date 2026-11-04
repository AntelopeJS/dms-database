import { guarded } from "../../guard.mjs";
import { check, pick } from "../../database.mjs";
import { chooseView, editor, flat, openConsole, resultText, runSource } from "./console.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */

export const extraJourneys = guarded([
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
      const whole = flat(await tab.page.locator("body").innerText());
      await ctx.verify("the table", [check("orders of eu: 80 rows", /orders\s+80 rows/.test(whole), whole.slice(0, 600))]);
      await tab.page.goBack();
      await tab.visible({ role: "heading", name: "Query console", level: 1 }, { timeoutMs: 30_000 });
      await tab.goto("/modules/database/data?schema=shop&table=orders&instance=eu&match=_id%3Aeu_ord_10401");
      await tab.visible({ role: "textbox", name: "Search rows" }, { timeoutMs: 60_000 });
      await tab.page.waitForTimeout(2000);
      const one = flat(await tab.page.locator("body").innerText());
      await ctx.verify("a row link", [check("one row, eu_ord_10401", /orders\s+1 row\b/.test(one) && one.includes("eu_ord_10401") && !one.includes("eu_ord_10400"), one.slice(0, 700))]);
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
