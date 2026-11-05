import { guarded } from "../guard.mjs";
import { check, db, list, pick, runQuery, tableQuery, text, withConfig } from "../database.mjs";

/** @typedef {import("../database.mjs").Ctx} Ctx */

const SLICE = (/** @type {number} */ end) => ({ stage: "slice", args: [0, end] });

/**
 * Opens the Overview as the owner.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../database.mjs").Tab>} The tab on the Overview
 */
async function overviewTab(ctx) {
  const tab = await ctx.tab();
  await tab.signIn("admin");
  await tab.goto("/modules/database/overview");
  await ctx.verify("the Overview opens", [tab.visible({ role: "heading", name: "Overview", level: 1 }, { timeoutMs: 30_000 }), tab.shows(/checked \d+ (s|min) ago/)], { critical: true });
  return tab;
}

/** The Overview: connection card, schema cards, largest tables, recent queries and the header buttons. */
export const journeys = guarded([
  {
    id: "the-connection-card-reads-the-probe",
    title: "the Connection card shows Healthy, the probe latency in ms, and the table, schema, row and index totals of the registered schemas",
    entryPoint: "/modules/database/overview, GET /api/database/health, /schemas",
    async run(/** @type {Ctx} */ ctx) {
      const health = await db(ctx, "health", "GET", "/health");
      const schemas = await db(ctx, "schemas", "GET", "/schemas");
      const rows = list(schemas.body, "schemas");
      const tables = rows.flatMap((schema) => list(schema, "tables"));
      const indexes = tables.reduce((sum, table) => sum + Object.keys(pick(table, "indexes") ?? {}).length, 0);
      const mine = ["demo", "shop", "vault", "metrics", "app-site", "core", "global", "staging-eu", "reviews", "production", "billing", "tenant-acme"];
      const tableCount = (/** @type {string} */ id) => list(rows.find((schema) => pick(schema, "id") === id), "tables").length;
      await ctx.verify("the API totals are the sums of the schemas", [
        check("tableCount is the number of tables of every schema", pick(health.body, "tableCount") === tables.length, [pick(health.body, "tableCount"), tables.length]),
        check("schemaCount is the number of schemas", pick(health.body, "schemaCount") === rows.length, [pick(health.body, "schemaCount"), rows.length]),
        check("indexCount is the number of declared indexes", pick(health.body, "indexCount") === indexes, [pick(health.body, "indexCount"), indexes]),
        check("the playground schemas hold 3, 4, 5 and 2 tables, one in each label schema", ["demo:3", "shop:4", "vault:5", "metrics:2"].every((pair) => tableCount(pair.split(":")[0] ?? "") === Number(pair.split(":")[1])) && mine.slice(4).every((id) => tableCount(id) === 1), mine.map((id) => [id, tableCount(id)])),
        check("totalRows counts the 1,250 readings", Number(pick(health.body, "totalRows")) >= 1250 + 6 + 8, pick(health.body, "totalRows")),
      ]);
      const tab = await overviewTab(ctx);
      const body = await tab.page.locator("body").innerText();
      const total = Number(pick(health.body, "totalRows"));
      const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(total);
      await ctx.verify("the card shows the same figures", [
        check("Healthy", /Healthy/.test(body), body.slice(0, 300)),
        check("a probe latency in ms", /Probe latency\s+\d+\s*ms/i.test(body.replace(/\n+/g, " ")), body.slice(0, 400)),
        check("Tables and its schema count", new RegExp(`Tables\\s+${tables.length}\\s+in ${rows.length} schemas`, "i").test(body.replace(/\n+/g, " ")), body.slice(0, 400)),
        check("Rows in compact form", new RegExp(`Rows\\s+${compact}\\s+in the default instances`, "i").test(body.replace(/\n+/g, " ")), [compact, body.slice(0, 400)]),
        check("Indexes", new RegExp(`Indexes\\s+${indexes}\\s+declared in code`, "i").test(body.replace(/\n+/g, " ")), body.slice(0, 400)),
      ]);
    },
  },
  {
    id: "a-configured-driver-label-shows-beside-the-age",
    title: "with driverLabel set, the Connection card names the database before the age of the last check; the label comes from the configuration, not from the driver",
    entryPoint: "driverLabel option, /modules/database/overview",
    async run(/** @type {Ctx} */ ctx) {
      await withConfig(ctx, { VERIFY_DATABASE_DRIVER_LABEL: "MongoDB 8.0" }, async () => {
        const health = await db(ctx, "health", "GET", "/health");
        const tab = await overviewTab(ctx);
        await ctx.verify("the label shows", [
          check("the API carries it", pick(health.body, "driver") === "MongoDB 8.0", pick(health.body, "driver")),
          tab.shows(/MongoDB 8\.0 · checked \d+ s ago/),
        ]);
      });
      const after = await db(ctx, "health without the label", "GET", "/health");
      await ctx.verify("without the option the driver is unknown", [check("driver is null", pick(after.body, "driver") === null, pick(after.body, "driver"))]);
    },
  },
  {
    id: "without-a-driver-label-the-card-shows-a-dash",
    title: "without driverLabel, the Overview shows a dash where the database name goes (configuration and FAQ)",
    entryPoint: "/modules/database/overview with no driverLabel",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await overviewTab(ctx);
      const line = await tab.page.getByText(/checked \d+ s ago/).first().innerText();
      await ctx.verify("the placeholder", [check("the line starts with a dash before the age", /^—\s*·?\s*checked/.test(line), line)]);
    },
  },
  {
    id: "the-card-age-counts-up-and-the-probe-repeats-every-thirty-seconds",
    title: "the age in 'checked N s ago' counts up by the second, and the page probes again after 30 seconds, so the age falls back under 30",
    entryPoint: "/modules/database/overview",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await overviewTab(ctx);
      const age = async () => Number(/checked (\d+) s ago/.exec(await tab.page.locator("body").innerText())?.[1] ?? Number.NaN);
      const first = await age();
      await tab.page.waitForTimeout(6000);
      const second = await age();
      await ctx.verify("the age counts up", [check("six seconds later it grew by 5 to 8", second - first >= 5 && second - first <= 8, [first, second])]);
      await tab.page.waitForTimeout(30_000);
      const third = await age();
      await ctx.verify("the probe ran again", [check("after 36 s the age is under 30, not about 40", third < 30, [first, second, third])]);
    },
  },
  {
    id: "schema-cards-list-every-schema-largest-first",
    title: "one card per registered schema, largest first, each with its instances, tables, rows and relations, and a card opens the Schemas list filtered on that schema",
    entryPoint: "/modules/database/overview, GET /api/database/overview/schemas",
    async run(/** @type {Ctx} */ ctx) {
      const feed = await db(ctx, "schema cards", "GET", "/overview/schemas");
      const schemas = await db(ctx, "schemas", "GET", "/schemas");
      const ids = list(schemas.body, "schemas").map((schema) => text(schema, "id"));
      const items = list(feed.body, "items");
      const rowsOf = (/** @type {Record<string, unknown>} */ item) => Number(pick(list(item, "readout")[0] ?? {}, "params", "rows", "params", "count", "value"));
      const counts = items.map(rowsOf);
      await ctx.verify("the feed", [
        check("one card for each registered schema", items.length === ids.length && ids.every((id) => items.some((item) => text(item, "id") === id)), [items.length, ids.length]),
        check("largest first", counts.every((value, index) => index === 0 || (counts[index - 1] ?? 0) >= value), counts),
        check("metrics, with 1,250 rows, is first", text(items[0], "id") === "metrics", items.map((item) => text(item, "id"))),
      ]);
      const tab = await overviewTab(ctx);
      const body = (await tab.page.locator("body").innerText()).replace(/\n+/g, " ");
      await ctx.verify("the cards read", [
        check("shop: 3 instances, 4 tables, 6 rows, 3 relations", /shop 3 instances 4 tables · 6 rows 3 relations/i.test(body), body.slice(0, 900)),
        check("metrics: 1 instance, 2 tables, 1.3K rows, 0 relations", /metrics 1 instance 2 tables · 1\.3K rows 0 relations/i.test(body), body.slice(0, 900)),
        check("demo: 3 tables, 8 rows, 2 relations", /demo 1 instance 3 tables · 8 rows 2 relations/i.test(body), body.slice(0, 900)),
      ]);
      await tab.click({ role: "link", name: /^demo 1 instance/ });
      await ctx.verify("the card opens the filtered list", [tab.at(/\/modules\/database\/schemas$/), tab.shows(/Tables\s+3/), tab.shows(/\bposts\b/), tab.shows(/\bshop\b/, { not: true })]);
    },
  },
  {
    id: "largest-tables-rank-the-default-instances-by-rows",
    title: "Largest tables lists the five tables with the most rows in the default instances, biggest first, each linking to the Data browser; a table holding rows only in named instances is left out",
    entryPoint: "/modules/database/overview, GET /api/database/overview/largest",
    async run(/** @type {Ctx} */ ctx) {
      const feed = await db(ctx, "largest tables", "GET", "/overview/largest");
      const items = list(feed.body, "items");
      const values = items.map((item) => Number(pick(item, "value")));
      await ctx.verify("the feed", [
        check("five tables", items.length === 5, items.length),
        check("readings first, with 1,250", text(items[0], "id") === "metrics::readings" && values[0] === 1250, items[0]),
        check("non-increasing", values.every((value, index) => index === 0 || (values[index - 1] ?? 0) >= value), values),
        check("products second, with 6 rows", text(items[1], "id") === "shop::products" && values[1] === 6, items[1]),
        check("shop.orders holds 160 rows in eu and us but none in default, so it is absent", !items.some((item) => text(item, "id") === "shop::orders"), items.map((item) => text(item, "id"))),
        check("each links to the Data browser", items.every((item) => text(item, "to") === `/modules/database/data?schema=${text(item, "id").split("::")[0]}&table=${text(item, "id").split("::")[1]}`), items.map((item) => text(item, "to"))),
      ]);
      const tab = await overviewTab(ctx);
      await ctx.verify("the list shows", [tab.shows(/readings\s+metrics\s+1\.3K/), tab.shows(/products\s+shop\s+6/)]);
      await tab.click({ role: "link", name: "products" });
      await ctx.verify("a row opens its table", [tab.at(/\/modules\/database\/data$/), tab.shows(/products\s+6 rows/)]);
    },
  },
  {
    id: "recent-queries-list-your-last-five-runs",
    title: "Recent queries starts empty, then lists the latest five runs of the signed-in owner, newest first, with the query text, its duration and row count or Failed, each linking to the console with that run",
    entryPoint: "/modules/database/overview, GET /api/database/overview/recent-queries",
    async run(/** @type {Ctx} */ ctx) {
      const empty = await overviewTab(ctx);
      await ctx.verify("nothing run yet", [empty.shows(/No query run yet/), check("the feed is empty", list((await db(ctx, "feed", "GET", "/overview/recent-queries")).body, "items").length === 0, "items")]);
      const sources = [];
      for (let index = 1; index <= 6; index += 1) {
        const source = `schemas.demo.instance().table("tags").slice(0, ${index})`;
        sources.push(source);
        const run = await runQuery(ctx, source, tableQuery("demo", "tags", [SLICE(index)]));
        if (run.status !== 200) throw new Error(`run ${index} answered ${run.status}`);
      }
      const failed = 'schemas.demo.instance().table("nope")';
      await runQuery(ctx, failed, tableQuery("demo", "nope"));
      sources.push(failed);
      const feed = list((await db(ctx, "feed", "GET", "/overview/recent-queries")).body, "items");
      const expected = sources.slice(-5).reverse();
      await ctx.verify("the feed", [
        check("five items, newest first", JSON.stringify(feed.map((item) => text(item, "title"))) === JSON.stringify(expected), feed.map((item) => text(item, "title"))),
        check("the failed run is flagged and tinted error", pick(feed[0], "tone") === "error" && JSON.stringify(pick(feed[0], "meta")).includes("failed"), feed[0]),
        check("each links to the console with its run", feed.every((item) => /^\/modules\/database\/query\?history=\w+/.test(text(item, "to"))), feed.map((item) => text(item, "to"))),
      ]);
      const tab = await overviewTab(ctx);
      await ctx.verify("the page lists them", [tab.shows(/slice\(0, 6\)/), tab.shows(/Failed/), tab.shows(/slice\(0, 1\)\)/, { not: true }), tab.shows(/slice\(0, 2\)\)/, { not: true })]);
      await tab.page.locator("a[href='/modules/database/query']").last().click();
      await ctx.verify("the link opens the console", [tab.at(/\/modules\/database\/query$/)]);
    },
  },
  {
    id: "the-header-buttons-lead-to-the-working-pages",
    title: "Open query console and Browse data lead to the Query console and the Data browser",
    entryPoint: "/modules/database/overview header actions",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await overviewTab(ctx);
      await tab.click({ role: "link", name: "Open query console" });
      await ctx.verify("the console opens", [tab.at(/\/modules\/database\/query$/), tab.visible({ role: "heading", name: "Query console", level: 1 })]);
      await tab.goto("/modules/database/overview");
      await tab.click({ role: "link", name: "Browse data" });
      await ctx.verify("the Data browser opens", [tab.at(/\/modules\/database\/data$/), tab.visible({ role: "heading", name: "Data browser", level: 1 })]);
    },
  },
]);
