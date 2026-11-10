import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { check, db, isRow, list, pick, text } from "../database.mjs";

/** @typedef {import("../database.mjs").Ctx} Ctx */

/**
 * @param {unknown} schemas The schemas answer
 * @param {string} schema A schema id
 * @param {string} table A table name
 * @returns {unknown} The table's summary
 */
function tableOf(schemas, schema, table) {
  const found = list(schemas, "schemas").find((row) => text(row, "id") === schema);
  return list(found, "tables").find((row) => text(row, "name") === table);
}

/** What a module gets by registering a schema, and the links other pages use. */
export const journeys = guarded([
  {
    id: "a-registered-schema-shows-its-tables-columns-indexes-relations-and-modifiers",
    title: "a schema registered with RegisterSchema lists its tables with their columns, indexes, relations and modifiers, and a table with named instances lists them",
    entryPoint: "GET /api/database/schemas, /tables/instances",
    async run(/** @type {Ctx} */ ctx) {
      const schemas = await db(ctx, "schemas", "GET", "/schemas");
      const orders = tableOf(schemas.body, "shop", "orders");
      const accounts = tableOf(schemas.body, "vault", "accounts");
      const instances = await db(ctx, "shop instances", "GET", "/tables/instances?schema=shop");
      const none = await db(ctx, "demo instances", "GET", "/tables/instances?schema=demo");
      const fields = pick(orders, "fields");
      await ctx.verify("the introspection", [
        check("orders has its declared columns", ["_id", "number", "customer_id", "status", "total", "created_at"].every((name) => isRow(fields) && name in fields), fields),
        check("orders has the indexes number, customer_id and the status_created group", JSON.stringify(Object.keys(pick(orders, "indexes") ?? {}).sort()) === JSON.stringify(["customer_id", "number", "status_created"]), pick(orders, "indexes")),
        check("orders points to customers through customer_id", list(orders, "relations").some((relation) => text(relation, "fromField") === "customer_id" && text(relation, "toTable") === "customers"), pick(orders, "relations")),
        check("accounts carries hashed, encrypted and localized modifiers on their fields", JSON.stringify(pick(accounts, "modifiers")) === JSON.stringify({ password: ["HashModifier"], card_number: ["EncryptionModifier"], display_name: ["LocalizationModifier"] }), pick(accounts, "modifiers")),
        check("shop lists its eu and us instances", JSON.stringify(pick(instances.body, "instances")) === JSON.stringify(["eu", "us"]), instances.body),
        check("a schema without named instances lists none", JSON.stringify(pick(none.body, "instances")) === "[]", none.body),
      ]);
    },
  },
  {
    id: "deep-links-open-the-documented-pages-on-the-table",
    title: "each link of the Link to the console table opens its page on the table: the inspector, the diagram focused on it, the data browser (default instance, a named instance, all instances) and the query console",
    entryPoint: "/modules/database/schemas?record=, /diagram?schema=&table=, /data?schema=&table=&instance=, /query?schema=&table=",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/database/schemas?record=shop::orders");
      await ctx.verify("the inspector opens on orders", [tab.shows(/Table \d+ of \d+/, { timeoutMs: 30_000 }), tab.visible({ role: "tab", name: "Columns" }), tab.shows(/Schema\s*·\s*shop/i)]);
      await tab.goto("/modules/database/diagram?schema=shop&table=orders");
      await ctx.verify("the diagram draws shop focused on orders", [tab.visible({ role: "heading", name: "Diagram", level: 1 }, { timeoutMs: 30_000 }), tab.shows(/order_items/), tab.shows(/customers/)]);
      await tab.goto("/modules/database/data?schema=shop&table=orders&instance=eu");
      await ctx.verify("the eu orders", [tab.shows(/orders\s+80 rows/, { timeoutMs: 30_000 })]);
      await tab.goto("/modules/database/data?schema=shop&table=orders&instance=us");
      await ctx.verify("the us orders", [tab.shows(/orders\s+80 rows/, { timeoutMs: 30_000 }), tab.shows(/#10400/)]);
      await tab.goto("/modules/database/data?schema=shop&table=orders&instance=all");
      await ctx.verify("all instances is read-only and reads both", [tab.shows(/orders\s+160 rows/, { timeoutMs: 30_000 }), tab.shows(/Read-only\./)]);
      await tab.goto("/modules/database/data?schema=shop&table=products");
      await ctx.verify("the default instance", [tab.shows(/products\s+6 rows/, { timeoutMs: 30_000 }), tab.shows(/Read-only\./, { not: true })]);
      await tab.goto("/modules/database/query?schema=shop&table=orders");
      await tab.page.waitForTimeout(3000);
      await ctx.verify("the console opens", [tab.visible({ role: "heading", name: "Query console", level: 1 }, { timeoutMs: 30_000 }), check("the editor holds a query on shop.orders", /schemas\.shop[\s\S]*table\("orders"\)/.test(await tab.page.getByRole("textbox", { name: "Query editor (AQL)" }).textContent() ?? ""), "editor")]);
    },
  },
  {
    id: "without-the-automation-module-the-trigger-registration-is-a-silent-no-op",
    title: "the module starts and answers without @antelopejs/dms-automation, and its start logs no error and no mention of the table-watch trigger",
    entryPoint: "the backend log of the run, GET /api/database/health",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.restartBackend();
      const log = readFileSync(join(ctx.state.logs, "backend.log"), "utf8");
      const mine = log.split("\n").filter((line) => /dms-database|table-watch|database\.table/i.test(line));
      const health = await db(ctx, "health", "GET", "/health");
      await ctx.verify("a quiet start", [
        check("the module answers", health.status === 200, health.status),
        check("no log line of the module is an error or a warning", !mine.some((line) => /\[(ERROR|WARN)\]/.test(line)), mine.slice(0, 5)),
        check("the trigger is not mentioned", !log.includes("table-watch"), "table-watch"),
      ]);
    },
  },
]);
