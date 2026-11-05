import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { check, db, list, member, parseJson, pick, runQuery, tableQuery, text } from "../database.mjs";

/** @typedef {import("../database.mjs").Ctx} Ctx */

const SELECTION = "filter_schema=shop&filter_table=products";

/** Every read route of the module, with the query string it needs. */
const READS = [
  "/health",
  "/schemas",
  "/overview/schemas",
  "/overview/largest",
  "/overview/recent-queries",
  "/tables/source",
  "/tables/instances?schema=shop",
  `/browse/list?${SELECTION}`,
  `/browse/count?${SELECTION}`,
  `/browse/columns?${SELECTION}`,
  "/browse/tables?filter_schema=shop",
  `/browse/references?${SELECTION}&id=sku_desk`,
  `/browse/get?${SELECTION}&id=sku_desk`,
  "/diagram/layout/shop",
  "/diagram/notes?schema=shop",
  "/query/saved",
  "/query/history",
  "/query/history/none",
];

/**
 * Every write route of the module, with a body it would accept from the owner.
 *
 * @type {[string, string, Record<string, unknown> | undefined][]}
 */
const WRITES = [
  ["PUT", "/browse/edit", { schema: "shop", table: "products", updates: [] }],
  ["POST", "/query/execute", { query: tableQuery("demo", "tags"), source: "x", language: "aql" }],
  ["POST", "/query/dry-run", { query: tableQuery("demo", "tags") }],
  ["POST", "/query/saved", { name: "q", query: tableQuery("demo", "tags"), source: "x", language: "aql", shared: true }],
  ["PUT", "/query/saved/none", { name: "q", query: tableQuery("demo", "tags"), source: "x", language: "aql" }],
  ["DELETE", "/query/saved/none", undefined],
  ["DELETE", "/query/history", undefined],
  ["PUT", "/diagram/layout/shop", { positions: {} }],
  ["POST", "/diagram/notes", { schema: "shop", text: "x", x: 0, y: 0 }],
  ["PUT", "/diagram/notes/none", { text: "x" }],
  ["DELETE", "/diagram/notes/none", undefined],
];

/** Who may reach the module: the platform owner, nobody else. */
export const journeys = guarded([
  {
    id: "every-route-needs-a-signed-in-session",
    title: "each page and API route of the module answers 401 to a visitor with no session, and the owner is not refused",
    entryPoint: "GET/PUT/POST/DELETE /api/database/* as nobody and as the owner",
    async run(/** @type {Ctx} */ ctx) {
      const anonymous = [];
      for (const path of READS) anonymous.push({ label: `GET ${path}`, answer: await db(ctx, `GET ${path} as nobody`, "GET", path, { as: "anon" }) });
      for (const [method, path, body] of WRITES) anonymous.push({ label: `${method} ${path}`, answer: await db(ctx, `${method} ${path} as nobody`, method, path, { as: "anon", body }) });
      const owner = await db(ctx, "health as the owner", "GET", "/health");
      await ctx.verify("401 without a session", [...anonymous.map((row) => check(`${row.label} is 401`, row.answer.status === 401, row.answer.status)), check("the owner reaches the module", owner.status === 200, owner.status)]);
    },
  },
  {
    id: "a-member-gets-403-from-every-route-and-writes-nothing",
    title: "a signed-in member, even one whose role holds the module's permissions, gets 403 from every route and changes no data, note, layout or history",
    entryPoint: "GET/PUT/POST/DELETE /api/database/* as a member",
    async run(/** @type {Ctx} */ ctx) {
      await runQuery(ctx, 'schemas.demo.instance().table("tags")', tableQuery("demo", "tags"));
      const beforeNotes = list((await db(ctx, "notes before", "GET", "/diagram/notes?schema=shop")).body, "notes").length;
      const beforeHistory = list((await db(ctx, "history before", "GET", "/query/history")).body, "items").length;
      await member(ctx, "granted", ["modules.database", "modules.database.explore", "modules.database.work"]);
      const refused = [];
      for (const path of READS) refused.push({ label: `GET ${path}`, answer: await db(ctx, `GET ${path} as the member`, "GET", path, { as: "granted" }) });
      for (const [method, path, body] of WRITES) refused.push({ label: `${method} ${path}`, answer: await db(ctx, `${method} ${path} as the member`, method, path, { as: "granted", body }) });
      const afterNotes = list((await db(ctx, "notes after", "GET", "/diagram/notes?schema=shop")).body, "notes").length;
      const history = await db(ctx, "history after", "GET", "/query/history");
      await ctx.verify("403 for the member", [
        ...refused.map((row) => check(`${row.label} is 403`, row.answer.status === 403, row.answer.status)),
        check("no note was added", afterNotes === beforeNotes, [beforeNotes, afterNotes]),
        check("the owner's history is intact", list(history.body, "items").length === beforeHistory && beforeHistory === 1, pick(history.body, "total")),
      ]);
    },
  },
  {
    id: "a-member-sees-neither-the-pages-nor-the-catalog-tile",
    title: "a member whose role holds the module's permissions does not see the Database module in the Modules catalog and cannot open its pages, while the owner sees the tile",
    entryPoint: "/modules, /modules/database/*",
    async run(/** @type {Ctx} */ ctx) {
      await member(ctx, "granted", ["modules.database", "modules.database.explore", "modules.database.work"]);
      const owner = await ctx.tab("admin");
      await owner.signIn("admin");
      await owner.goto("/modules");
      await ctx.verify("the owner sees the tile", [owner.visible({ role: "article", name: "Database" }, { timeoutMs: 30_000 })]);
      const guest = await ctx.tab("granted");
      await guest.signIn("granted");
      await guest.goto("/modules");
      await ctx.verify("the member's catalog", [guest.visible({ role: "heading", level: 1 }, { timeoutMs: 30_000 }), guest.visible({ role: "article", name: "Database" }, { hidden: true, timeoutMs: 5000 })]);
      const pages = [];
      for (const page of ["overview", "schemas", "diagram", "data", "query"]) {
        await guest.goto(`/modules/database/${page}`);
        await guest.page.waitForTimeout(2500);
        pages.push({ page, at: new URL(guest.page.url()).pathname, heading: await guest.page.getByRole("heading", { name: /^(Overview|Schemas|Diagram|Data browser|Query console)$/, level: 1 }).count() });
      }
      await ctx.verify("no page opens", pages.map((row) => check(`/modules/database/${row.page} is not shown`, row.heading === 0, row)));
    },
  },
  {
    id: "the-catalog-tile-reads-the-database",
    title: "the Modules catalog tile of the owner reads the tables, rows, schemas and probe latency of the database, in the Data category, with the module's version",
    entryPoint: "/modules, GET /api/database/health",
    async run(/** @type {Ctx} */ ctx) {
      const health = await db(ctx, "health", "GET", "/health");
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules");
      await ctx.verify("the tile", [tab.visible({ role: "article", name: "Database" }, { timeoutMs: 30_000 })]);
      const tile = (await tab.page.getByRole("article", { name: "Database" }).first().innerText()).replace(/\s+/g, " ");
      const rows = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(pick(health.body, "totalRows")));
      const manifest = parseJson(readFileSync(join(ctx.state.repo ?? ".", "package.json"), "utf8"));
      await ctx.verify("the readout", [
        check("tables and rows", tile.includes(`${String(pick(health.body, "tableCount"))} tables · ${rows} rows`), tile),
        check("schemas and probe latency", /\d+ schemas · probe \d+ ms/.test(tile) && tile.includes(`${String(pick(health.body, "schemaCount"))} schemas`), tile),
        check("the version of the package", tile.includes(`v${text(manifest, "version")}`), [tile, text(manifest, "version")]),
        check("the Data category", /Data/.test(tile), tile),
      ]);
    },
  },
  {
    id: "the-owner-only-gate-is-logged-at-start",
    title: "at start the backend logs 'Module route /modules/database/<page>/... gated owner-only' for each of the five pages, as the FAQ tells an owner to check",
    entryPoint: "the backend log of the run",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.restartBackend();
      const log = readFileSync(join(ctx.state.logs, "backend.log"), "utf8");
      await ctx.verify("the log", ["overview", "schemas", "diagram", "data", "query"].map((page) => check(`${page} is gated`, log.includes(`Module route /modules/database/${page}/... gated owner-only`), page)));
    },
  },
]);
