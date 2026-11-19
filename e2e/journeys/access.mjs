import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, db, member, parseJson, pick, text } from "../database.mjs";

/** @typedef {import("../database.mjs").Ctx} Ctx */

/** Who may reach the module: the platform owner, nobody else. */
export const journeys = [
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
    tag: "@smoke",
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
      const manifest = parseJson(readFileSync(join(ctx.repo, "package.json"), "utf8"));
      await ctx.verify("the readout", [
        check("tables and rows", tile.includes(`${String(pick(health.body, "tableCount"))} tables · ${rows} rows`), tile),
        check("schemas and probe latency", /\d+ schemas · probe \d+ ms/.test(tile) && tile.includes(`${String(pick(health.body, "schemaCount"))} schemas`), tile),
        check("the version of the package", tile.includes(`v${text(manifest, "version")}`), [tile, text(manifest, "version")]),
        check("the Data category", /Data/.test(tile), tile),
      ]);
    },
  },
];
