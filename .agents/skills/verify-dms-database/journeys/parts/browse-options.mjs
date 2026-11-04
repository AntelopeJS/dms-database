import { guarded } from "../../guard.mjs";
import { check } from "../../database.mjs";
import { gridRows, openTable, pickPageSize, settle, toolbarCount } from "./browse.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */

/**
 * The options a menu offers, then closes it.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} The option names in order
 */
async function offered(tab) {
  const options = await tab.page.getByRole("option").allInnerTexts();
  await tab.page.keyboard.press("Escape");
  return options.map((option) => option.replace(/\s+/g, " ").trim());
}

export const optionJourneys = guarded([
  {
    id: "rows-per-page-offers-exactly-25-50-100-and-200",
    title: "the footer's rows-per-page menu offers exactly 25, 50, 100 and 200, and each size pages the table by that many rows",
    entryPoint: "/modules/database/data footer, metrics.readings (1,250 rows)",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await openTable(tab, "metrics", "readings");
      const footer = tab.page.locator("footer", { has: tab.page.getByRole("navigation", { name: "Pagination" }) });
      await footer.getByRole("combobox").click();
      const menu = await offered(tab);
      const counts = [];
      for (const size of [25, 100, 200, 50]) {
        await pickPageSize(tab, size);
        const rows = await settle(async () => (await gridRows(tab)).length, (count) => count === size);
        counts.push([size, rows]);
      }
      await ctx.verify("the menu", [
        check("exactly 25, 50, 100 and 200 in that order", JSON.stringify(menu) === JSON.stringify(["25", "50", "100", "200"]), menu),
        check("each size shows that many rows", counts.every(([size, rows]) => size === rows), counts),
        check("the count does not change with the size", (await toolbarCount(tab)) === "1,250 rows", await toolbarCount(tab)),
      ]);
    },
  },
  {
    id: "a-filter-is-either-contains-or-is-exactly-in-the-dialog-and-in-a-column-funnel",
    title: "Add filter and a column's funnel each offer exactly the modes contains and is exactly",
    entryPoint: "/modules/database/data Add filter and the header funnels",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await openTable(tab, "metrics", "readings");
      await tab.click({ role: "button", name: "Add filter" });
      const dialog = tab.page.getByRole("dialog", { name: "Add filter" });
      await dialog.getByRole("combobox").nth(0).click();
      const columns = await offered(tab);
      await dialog.getByRole("combobox").nth(1).click();
      const dialogModes = await offered(tab);
      await tab.page.keyboard.press("Escape");
      await tab.page.waitForTimeout(500);
      const funnels = [];
      for (const column of ["seq", "band"]) {
        await tab.click({ role: "button", name: `Filter ${column}` });
        const popover = tab.page.getByRole("dialog");
        await popover.getByRole("combobox").click();
        funnels.push([column, await offered(tab)]);
        await tab.page.keyboard.press("Escape");
        await tab.page.waitForTimeout(400);
      }
      await ctx.verify("the modes", [
        check("Add filter lists the table's columns", JSON.stringify(columns) === JSON.stringify(["_id", "seq", "band", "value"]), columns),
        check("Add filter offers exactly contains and is exactly", JSON.stringify(dialogModes) === JSON.stringify(["contains", "is exactly"]), dialogModes),
        check("every funnel offers exactly contains and is exactly", funnels.every(([, modes]) => JSON.stringify(modes) === JSON.stringify(["contains", "is exactly"])), funnels),
      ]);
    },
  },
]);
