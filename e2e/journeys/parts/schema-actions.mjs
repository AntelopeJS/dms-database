import { check } from "../../database.mjs";
import { drawer, openInspector } from "./schema-inspector.mjs";
import { listUntil, openSchemas, params } from "./schema-page.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */
/** @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef */

const SHOP = "?scope=shop&instance=eu";
const PAGES = [
  { action: "Browse data", path: "/modules/database/data" },
  { action: "Query this table", path: "/modules/database/query" },
  { action: "Show in diagram", path: "/modules/database/diagram" },
];

/**
 * @param {Tab} tab The tab on a page opened from the Schemas page
 * @param {string} path The path awaited
 * @returns {Promise<import("../../database.mjs").Check[]>} Checks that the page is that page on products
 */
async function landedOnProducts(tab, path) {
  const at = await tab.at(new RegExp(`^${path}$`));
  const query = params(tab);
  const checks = [at];
  if (!path.endsWith("/query")) checks.push(check("the URL names shop and products", query.get("schema") === "shop" && query.get("table") === "products", tab.page.url()));
  if (path.endsWith("/data")) checks.push(await tab.shows(/products\s+6 rows/));
  if (path.endsWith("/query")) {
    const editor = tab.page.getByRole("textbox", { name: "Query editor (AQL)" });
    await editor.waitFor({ state: "visible", timeout: 20_000 });
    await tab.page.waitForTimeout(1500);
    const source = (await editor.textContent()) ?? "";
    checks.push(check("the editor is prefilled with the table", source.includes('table("products")') && source.includes("shop"), source));
  }
  if (path.endsWith("/diagram")) checks.push(await tab.shows(/products\s+Inspect\s+Focus/));
  return checks;
}

/** @type {JourneyDef} */
export const actions = {
  id: "browse-query-and-diagram-actions-open-the-other-pages-on-the-same-table",
  title: "from the inspector and from the row menu, Browse data, Query this table and Show in diagram open the data browser, the query console and the diagram on the same table, and Inspect opens the drawer",
  entryPoint: "/modules/database/schemas inspector actions and row menu",
  async run(ctx) {
    for (const { action, path } of PAGES) {
      const tab = await openInspector(ctx, `${SHOP}&record=shop::products`, "products");
      await tab.click({ role: "link", name: action, within: { role: "dialog" } });
      await ctx.verify(`${action} in the inspector`, await landedOnProducts(tab, path));
    }
    for (const { action, path } of PAGES) {
      const tab = await openSchemas(ctx, SHOP);
      await listUntil(tab, (rows) => rows.length === 4);
      await tab.click({ role: "button", name: "Actions for products" });
      await tab.click({ role: "menuitem", name: action });
      await ctx.verify(`${action} in the row menu`, await landedOnProducts(tab, path));
    }
    const menu = await openSchemas(ctx, SHOP);
    await listUntil(menu, (rows) => rows.length === 4);
    await menu.click({ role: "button", name: "Actions for products" });
    const items = await menu.page.getByRole("menuitem").allTextContents();
    await menu.click({ role: "menuitem", name: "Inspect" });
    await menu.page.getByRole("dialog", { name: "products", exact: true }).waitFor({ state: "visible", timeout: 20_000 });
    await ctx.verify("the row menu", [
      check("it offers the four actions in order", items.map((item) => item.trim()).join() === "Inspect,Browse data,Query this table,Show in diagram", items),
      check("Inspect opens the drawer of the row and keeps it in the URL", params(menu).get("record") === "shop::products", menu.page.url()),
      check("the drawer is headed by the table", (await drawer(menu).getByRole("heading", { level: 2 }).innerText()) === "products", "heading"),
    ]);

    const header = await openSchemas(ctx);
    await header.click({ role: "link", name: "Diagram", nth: 1 });
    await ctx.verify("the Diagram button of the page header", [await header.at(/^\/modules\/database\/diagram$/), check("it opens the diagram without a table", !params(header).has("table"), header.page.url())]);
  },
};
