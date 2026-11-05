import { guarded } from "../guard.mjs";
import { check, db, list, pick } from "../database.mjs";

/** @typedef {import("../database.mjs").Ctx} Ctx */

/** The introduction's path: check the connection, find a table, read its rows, run a query. */
export const journeys = guarded([
  {
    id: "smoke",
    title: "the owner reads a healthy connection on the Overview, finds shop.products in Schemas, reads its six rows in the Data browser and runs a query on it in the Query console",
    entryPoint: "/modules/database/overview, /schemas, /data, /query",
    async run(/** @type {Ctx} */ ctx) {
      const health = await db(ctx, "health", "GET", "/health");
      await ctx.verify("the API reports a healthy connection", [check("status ok with a probe latency", pick(health.body, "status") === "ok" && Number.isFinite(pick(health.body, "latencyMs")), health.body)], { critical: true });
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/database/overview");
      await ctx.verify("the Overview reads the connection", [
        tab.visible({ role: "heading", name: "Overview", level: 1 }, { timeoutMs: 30_000 }),
        tab.shows(/Healthy/),
        tab.shows(new RegExp(`in ${String(pick(health.body, "schemaCount"))} schemas`)),
      ]);
      await tab.click({ role: "link", name: "Schemas", exact: true });
      await tab.fill({ role: "textbox", name: "Find a table or column" }, "products");
      await ctx.verify("Schemas finds the table", [tab.visible({ role: "cell", name: "products Copy" })]);
      await tab.goto("/modules/database/data?schema=shop&table=products");
      await ctx.verify("the Data browser shows the six products", [tab.shows(/products\s+6 rows/), tab.visible({ role: "cell", name: "Standing desk" })]);
      const rows = await db(ctx, "products rows", "GET", "/browse/list?filter_schema=shop&filter_table=products");
      await ctx.verify("the API reads the same six rows", [check("six rows with the desk", pick(rows.body, "total") === 6 && list(rows.body, "results").some((row) => row.name === "Standing desk"), rows.body)]);
    },
  },
]);
