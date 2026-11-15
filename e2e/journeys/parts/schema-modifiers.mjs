import { check, text } from "../../database.mjs";
import { ids, source } from "./schema-api.mjs";
import { openSchemas, listUntil, pickFrom } from "./schema-page.mjs";
import { drawer, openInspector } from "./schema-inspector.mjs";

/**
 * @typedef {import("../../database.mjs").Ctx} Ctx
 * @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef
 */

const EXPECTED = {
  "mods::hashed_only": ["Hashed"],
  "mods::localized_only": ["Localized"],
  "mods::encrypted_only": ["Encrypted"],
  "vault::accounts": ["Hashed", "Encrypted", "Localized"],
};

/** @type {JourneyDef} */
export const orRule = {
  id: "with-modifiers-keeps-a-table-with-only-a-hashed-only-a-localized-or-only-an-encrypted-column",
  title: "With modifiers keeps the tables with hashed, localized or encrypted columns: a table with just one of the three stays, in the API and in the list, and each row flags exactly its own modifiers",
  entryPoint: "GET /api/database/tables/source?filter_has=modifiers, /modules/database/schemas",
  async run(ctx) {
    const kept = await source(ctx, "modifiers everywhere", { has: "modifiers" });
    const plain = await source(ctx, "no flag, in mods", { scope: "mods" });
    await ctx.verify("the API", [
      check("every kept table has a modifier and the four of the playground are among them", kept.rows.every((row) => Array.isArray(row.modifiers) && row.modifiers.length > 0) && Object.keys(EXPECTED).every((id) => ids(kept.rows).includes(id)), ids(kept.rows)),
      check("no table without a modifier is kept", !ids(kept.rows).some((id) => id.startsWith("mods::plain") || id === "shop::orders" || id === "vault::plain_notes"), ids(kept.rows)),
      ...Object.entries(EXPECTED).map(([id, modifiers]) => check(`${id} flags ${modifiers.join(", ")}`, JSON.stringify(kept.rows.find((row) => text(row, "id") === id)?.modifiers) === JSON.stringify(modifiers), kept.rows.find((row) => text(row, "id") === id))),
      check("mods registers three tables, all of them kept", plain.rows.length === 3 && Object.keys(EXPECTED).filter((id) => id.startsWith("mods::")).every((id) => ids(kept.rows).includes(id)), [plain.total, ids(plain.rows)]),
    ]);
    const tab = await openSchemas(ctx, "?has=modifiers");
    const rows = await listUntil(tab, (found) => found.length === kept.rows.length);
    const byName = (/** @type {string} */ schema, /** @type {string} */ name) => rows.find((row) => row.schema === schema && row.name === name);
    await ctx.verify("the list", [
      check("the list keeps the same tables as the API", JSON.stringify(rows.map((row) => `${row.schema}::${row.name}`).sort()) === JSON.stringify(ids(kept.rows).sort()), rows.map((row) => `${row.schema}.${row.name}`)),
      check("the hashed-only table shows Hashed alone", JSON.stringify(byName("mods", "hashed_only")?.modifiers) === JSON.stringify(["Hashed"]), byName("mods", "hashed_only")),
      check("the localized-only table shows Localized alone", JSON.stringify(byName("mods", "localized_only")?.modifiers) === JSON.stringify(["Localized"]), byName("mods", "localized_only")),
      check("the encrypted-only table shows Encrypted alone", JSON.stringify(byName("mods", "encrypted_only")?.modifiers) === JSON.stringify(["Encrypted"]), byName("mods", "encrypted_only")),
      check("accounts shows all three", JSON.stringify(byName("vault", "accounts")?.modifiers) === JSON.stringify(["Hashed", "Encrypted", "Localized"]), byName("vault", "accounts")),
    ]);
    await pickFrom(tab, "Schema", "mods");
    const scoped = await listUntil(tab, (found) => found.length === 3 && found.every((row) => row.schema === "mods"));
    await ctx.verify("the chip with a schema", [check("the three tables of mods", scoped.map((row) => row.name).sort().join() === "encrypted_only,hashed_only,localized_only", scoped.map((row) => row.name))]);
  },
};

/** @type {JourneyDef} */
export const narrowDrawer = {
  id: "a-narrow-inspector-scrolls-its-columns-table-and-its-tabs-sideways",
  title: "narrowing the inspector to its smallest width makes the columns table and the tab strip scroll sideways instead of cutting their content",
  entryPoint: "/modules/database/schemas drawer edge",
  async run(ctx) {
    const tab = await openInspector(ctx, "?scope=shop&record=shop::orders", "orders");
    const grip = tab.page.getByRole("separator", { name: "Resize the drawer" });
    const width = async () => (await drawer(tab).evaluate((element) => element.getBoundingClientRect().width)) ?? 0;
    const wide = await width();
    const handle = await grip.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await tab.page.mouse.move(handle.x, handle.y);
    await tab.page.mouse.down();
    await tab.page.mouse.move(handle.x + 400, handle.y, { steps: 6 });
    await tab.page.mouse.move(handle.x + 900, handle.y, { steps: 8 });
    await tab.page.mouse.up();
    await tab.page.waitForTimeout(800);
    const narrow = await width();
    const sideways = await drawer(tab).evaluate((dialog) => {
      /** @param {Element | null} element @returns {boolean} */
      const scrolls = (element) => {
        for (let node = element; node && node !== dialog.parentElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          if ((style.overflowX === "auto" || style.overflowX === "scroll") && node.scrollWidth > node.clientWidth + 1) return true;
        }
        return false;
      };
      return { tabs: scrolls(dialog.querySelector('[role="tablist"]')), columns: scrolls(dialog.querySelector("table")) };
    });
    await ctx.verify("a narrow drawer", [
      check("the drawer got narrower", narrow < wide - 100, [wide, narrow]),
      check("the columns table scrolls sideways", sideways.columns, sideways),
      check("the tab strip scrolls sideways", sideways.tabs, sideways),
    ]);
  },
};

export const modifierJourneys = [orRule, narrowDrawer];
