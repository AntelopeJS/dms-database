import { guarded } from "../guard.mjs";
import { check, db, list, pick, text, withConfig } from "../database.mjs";

/** @typedef {import("../database.mjs").Ctx} Ctx */

/**
 * The badge each schema card carries, read from the Overview feed.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<Map<string, string>>} Schema id to "label/tone", or "none/primary" for no label
 */
async function badges(ctx) {
  const feed = await db(ctx, "schema cards", "GET", "/overview/schemas");
  return new Map(list(feed.body, "items").map((item) => [text(item, "id"), `${text(item, "description") || "none"}/${text(item, "iconTone")}`]));
}

/** `schemaLabels` and the built-in patterns that badge schemas. */
export const journeys = guarded([
  {
    id: "built-in-patterns-label-schemas-by-the-start-of-their-id",
    title: "with no configuration, schemas starting with app, core, global, staging, reviews and production get Application/info, Core/primary, Global/neutral, Staging/warning, Reviews/secondary and Production/success; others get no label",
    entryPoint: "GET /api/database/overview/schemas",
    async run(/** @type {Ctx} */ ctx) {
      const found = await badges(ctx);
      const expected = { "app-site": "Application/info", core: "Core/primary", global: "Global/neutral", "staging-eu": "Staging/warning", reviews: "Reviews/secondary", production: "Production/success", billing: "none/primary", "tenant-acme": "none/primary", demo: "none/primary", shop: "none/primary" };
      await ctx.verify("the built-in labels", Object.entries(expected).map(([id, badge]) => check(`${id} is ${badge}`, found.get(id) === badge, found.get(id))));
    },
  },
  {
    id: "an-exact-key-beats-a-pattern-which-beats-a-built-in-label",
    title: "schemaLabels resolve in order: the entry whose key equals the schema id, then the first key with * that matches, then the built-in pattern; two matching patterns give the first one",
    entryPoint: "schemaLabels option, GET /api/database/overview/schemas",
    async run(/** @type {Ctx} */ ctx) {
      const labels = "tenant-acme:Acme:error;tenant-*:Tenant data:warning;*-acme:Late:info;billing:Billing:success;core:Kernel:neutral;app-*:Apps:secondary";
      await withConfig(ctx, { VERIFY_DATABASE_SCHEMA_LABELS: labels }, async () => {
        const found = await badges(ctx);
        await ctx.verify("the resolution order", [
          check("an exact key wins over a pattern that also matches (tenant-acme)", found.get("tenant-acme") === "Acme/error", found.get("tenant-acme")),
          check("an exact key wins over a built-in label (core)", found.get("core") === "Kernel/neutral", found.get("core")),
          check("an exact key labels a schema with none (billing)", found.get("billing") === "Billing/success", found.get("billing")),
          check("a pattern wins over a built-in label (app-site)", found.get("app-site") === "Apps/secondary", found.get("app-site")),
          check("a schema no entry matches keeps its built-in label (global)", found.get("global") === "Global/neutral", found.get("global")),
          check("a schema nothing matches has no label (shop)", found.get("shop") === "none/primary", found.get("shop")),
        ]);
      });
      await withConfig(ctx, { VERIFY_DATABASE_SCHEMA_LABELS: "tenant-*:Tenant data:warning;*-acme:Late:info" }, async () => {
        const found = await badges(ctx);
        await ctx.verify("the first matching pattern wins", [check("tenant-acme takes the first pattern", found.get("tenant-acme") === "Tenant data/warning", found.get("tenant-acme"))]);
      });
      await withConfig(ctx, { VERIFY_DATABASE_SCHEMA_LABELS: "*-acme:Late:info;tenant-*:Tenant data:warning" }, async () => {
        const found = await badges(ctx);
        await ctx.verify("the order of the entries decides", [check("tenant-acme takes the other pattern when it comes first", found.get("tenant-acme") === "Late/info", found.get("tenant-acme"))]);
      });
    },
  },
  {
    id: "a-glob-key-matches-the-whole-schema-id",
    title: "a key with * labels a schema only when the pattern covers its whole id: app-*i, *-ac and pp-* leave app-site and tenant-acme with their own label, while app-*e and *-acme label them",
    entryPoint: "schemaLabels option, GET /api/database/overview/schemas",
    async run(/** @type {Ctx} */ ctx) {
      await withConfig(ctx, { VERIFY_DATABASE_SCHEMA_LABELS: "app-*i:Cut:error;*-ac:Cut:error;pp-*:Cut:error" }, async () => {
        const found = await badges(ctx);
        await ctx.verify("a pattern that covers part of the id", [
          check("app-*i stops before the end of app-site and pp-* starts after its beginning: app-site keeps its built-in label", found.get("app-site") === "Application/info", found.get("app-site")),
          check("*-ac stops before the end of tenant-acme: it keeps none", found.get("tenant-acme") === "none/primary", found.get("tenant-acme")),
        ]);
      });
      await withConfig(ctx, { VERIFY_DATABASE_SCHEMA_LABELS: "app-*e:Whole:error;*-acme:Whole:warning" }, async () => {
        const found = await badges(ctx);
        await ctx.verify("a pattern that covers the whole id", [
          check("app-*e labels app-site", found.get("app-site") === "Whole/error", found.get("app-site")),
          check("*-acme labels tenant-acme", found.get("tenant-acme") === "Whole/warning", found.get("tenant-acme")),
        ]);
      });
    },
  },
  {
    id: "a-label-takes-each-of-the-seven-tones",
    title: "color takes primary, secondary, success, info, warning, error or neutral and shows as the card's tone; a label without a color shows the primary tone",
    entryPoint: "schemaLabels option, GET /api/database/overview/schemas",
    async run(/** @type {Ctx} */ ctx) {
      const tones = { demo: "primary", shop: "secondary", vault: "success", metrics: "info", billing: "warning", "tenant-acme": "error", global: "neutral" };
      const labels = [...Object.entries(tones).map(([id, tone]) => `${id}:L-${id}:${tone}`), "reviews:Plain"].join(";");
      await withConfig(ctx, { VERIFY_DATABASE_SCHEMA_LABELS: labels }, async () => {
        const found = await badges(ctx);
        await ctx.verify("the tones", [
          ...Object.entries(tones).map(([id, tone]) => check(`${id} is ${tone}`, found.get(id) === `L-${id}/${tone}`, found.get(id))),
          check("a label with no color keeps the primary tone", found.get("reviews") === "Plain/primary", found.get("reviews")),
        ]);
        const tab = await ctx.tab();
        await tab.signIn("admin");
        await tab.goto("/modules/database/overview");
        await ctx.verify("the card shows the label", [tab.visible({ role: "heading", name: "Overview", level: 1 }, { timeoutMs: 30_000 }), tab.shows(/L-tenant-acme/)]);
      });
      const health = await db(ctx, "health", "GET", "/health");
      await ctx.verify("the options are read at start", [check("labels are gone after the restart without them", pick(health.body, "driver") === null && (await badges(ctx)).get("demo") === "none/primary", pick(health.body, "driver"))]);
    },
  },
]);
