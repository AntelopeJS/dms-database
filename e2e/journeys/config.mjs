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
export const journeys = [
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
];
