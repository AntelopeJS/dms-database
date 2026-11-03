import { check } from "../../database.mjs";
import { byName, nodes, openDiagram, ready, savedLayout, tables, zoomPercent } from "./diagram-page.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */
/** @typedef {import("./diagram-page.mjs").Node} Node */
/** @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef */

/**
 * @param {Node | undefined} node A table node
 * @returns {string[]} Its rows as `name:type`
 */
const rowsOf = (node) => (node?.rows ?? []).map((row) => `${row.name}:${row.type}`);

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} The relation arrows, as the canvas labels them
 */
async function edges(tab) {
  const labels = await tab.page.evaluate(() => [...document.querySelectorAll(".vue-flow__edge")].map((edge) => edge.getAttribute("aria-label") ?? ""));
  return labels.sort();
}

/** @type {JourneyDef} */
export const reading = {
  id: "tables-list-their-columns-with-types-and-icons-and-relations-are-arrows",
  title: "each table lists its columns with their types, icons mark the primary key, relations, objects and encrypted columns, a relation is an arrow from its column to the table it points to, and the legend names the icons",
  entryPoint: "/modules/database/diagram?schema=shop",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=shop");
    const drawn = await tables(tab);
    const arrows = await edges(tab);
    const legend = await tab.page.locator(".diagram-legend").innerText();
    const legendIcons = await tab.page.evaluate(() => [...document.querySelectorAll(".diagram-legend svg use")].map((icon) => icon.getAttribute("href") ?? ""));
    const [keyIcon, relationIcon, objectIcon, lockIcon] = legendIcons;
    const first = (/** @type {string} */ table, /** @type {string} */ column) => byName(drawn, table)?.rows.find((row) => row.name === column)?.icons[0];
    await ctx.verify("the shop diagram", [
      check("it draws the four tables", drawn.map((node) => node.name).sort().join() === "customers,order_items,orders,products", drawn.map((node) => node.name)),
      check("customers lists its columns with their types", rowsOf(byName(drawn, "customers")).join() === "_id:string,email:email,company:string,credit_limit:number,vip:boolean", rowsOf(byName(drawn, "customers"))),
      check("orders lists its columns, a relation naming its target and an object", rowsOf(byName(drawn, "orders")).join() === "_id:string,number:string,customer_id:customers,status:string,created_at:date,channel:string,total:number,currency:string,coupon_id:string | null,shipping:object", rowsOf(byName(drawn, "orders"))),
      check("order_items points to orders and products", rowsOf(byName(drawn, "order_items")).join() === "_id:string,order_id:orders,product_id:products,quantity:number,unit_price:number", rowsOf(byName(drawn, "order_items"))),
      check("an array reads as its element type", rowsOf(byName(drawn, "products")).join() === "_id:string,name:string,price:number,tags:string[]", rowsOf(byName(drawn, "products"))),
      check("the legend holds four distinct icons", legendIcons.length === 4 && new Set(legendIcons).size === 4, legendIcons),
      check("every primary key carries the legend's key icon", ["customers", "products", "orders", "order_items"].every((table) => first(table, "_id") === keyIcon), keyIcon),
      check("every relation column carries the legend's relation icon", first("orders", "customer_id") === relationIcon && first("order_items", "order_id") === relationIcon && first("order_items", "product_id") === relationIcon, relationIcon),
      check("an object column carries the legend's object icon", first("orders", "shipping") === objectIcon, objectIcon),
      check("a plain column carries none of the four", ![keyIcon, relationIcon, objectIcon, lockIcon].includes(first("orders", "total")) && ![keyIcon, relationIcon, objectIcon, lockIcon].includes(first("customers", "email")), first("orders", "total")),
      check("one arrow per relation, from the column's table to the target", arrows.join("|") === "Edge from shop::order_items to shop::orders|Edge from shop::order_items to shop::products|Edge from shop::orders to shop::customers", arrows),
      check("each arrow is labelled with its column", (await tab.page.locator(".diagram-edge-label").allTextContents()).map((label) => label.trim()).sort().join() === "customer_id,order_id,product_id", await tab.page.locator(".diagram-edge-label").allTextContents()),
      check("each arrow ends in an arrowhead", (await tab.page.locator(".vue-flow__edge-path").count()) === 3 && (await tab.page.locator(".vue-flow__edge-path[marker-end]").count()) === 3, "markers"),
      check("the legend names key, relation, object and encrypted", legend.split("\n").map((line) => line.trim()).filter(Boolean).join() === "Primary key,Relation,Object,Encrypted", legend),
      check("the diagram shows no stub where every target is drawn", (await nodes(tab)).filter((node) => node.kind === "stubNode").length === 0, "stubs"),
    ]);

  },
};

/** @type {JourneyDef} */
export const modifierIcons = {
  id: "an-encrypted-column-carries-the-lock-icon-of-the-legend",
  title: "a column with an encrypted modifier carries the legend's lock icon named Encrypted, and the hashed and localized columns carry their own icons, not the lock",
  entryPoint: "/modules/database/diagram?schema=vault",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=vault");
    const legendIcons = await tab.page.evaluate(() => [...document.querySelectorAll(".diagram-legend svg use")].map((icon) => icon.getAttribute("href") ?? ""));
    const lockIcon = legendIcons[3];
    const accounts = byName(await tables(tab), "accounts");
    const row = (/** @type {string} */ name) => accounts?.rows.find((entry) => entry.name === name);
    await ctx.verify("the vault diagram", [
      check("an encrypted column carries the legend's lock icon, named Encrypted", row("card_number")?.icons.includes(lockIcon ?? "?") === true && row("card_number")?.title === "Encrypted", row("card_number")),
      check("a hashed and a localized column carry their own named icons", row("password")?.title === "Hashed" && row("display_name")?.title === "Localized" && row("password")?.icons.includes(lockIcon ?? "?") === false && row("display_name")?.icons.includes(lockIcon ?? "?") === false, [row("password"), row("display_name")]),
      check("no other column of accounts is marked encrypted", accounts?.rows.filter((entry) => entry.icons.includes(lockIcon ?? "?")).length === 1, accounts?.rows),
    ]);
  },
};

/** @type {JourneyDef} */
export const folding = {
  id: "a-table-of-more-than-twelve-columns-comes-folded-and-folding-is-not-saved",
  title: "a table of more than 12 columns shows its first 12 then + N columns, a click or Enter on that row unfolds it, Fold columns folds it back, a reload folds it again and the saved layout holds no folding",
  entryPoint: "/modules/database/diagram?schema=vault",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=vault");
    const folded = byName(await tables(tab), "wide_records");
    const names = (/** @type {Node | undefined} */ node) => (node?.rows ?? []).map((row) => row.name);
    await ctx.verify("a folded table", [
      check("it shows the first twelve columns, the key and the relation among them", names(folded).join() === "_id,registry_id,c01,c02,c03,c04,c05,c06,c07,c08,c09,c10", names(folded)),
      check("the hidden columns are counted in the row that unfolds it", folded?.toggle === "+ 5 columns", folded?.toggle),
      check("the tail column is not drawn", !names(folded).includes("tail_marker") && !names(folded).includes("c11"), names(folded)),
      check("the table says it is folded", folded?.expanded === "false", folded?.expanded),
      check("a table of 5 columns has no fold row", byName(await tables(tab), "accounts")?.toggle === "", byName(await tables(tab), "accounts")?.toggle),
    ]);

    await tab.click({ role: "button", name: "+ 5 columns" });
    await tab.page.waitForTimeout(500);
    const open = byName(await tables(tab), "wide_records");
    await ctx.verify("a click unfolds", [
      check("all 17 columns are drawn, tail_marker last", names(open).length === 17 && names(open).at(-1) === "tail_marker", names(open)),
      check("the row now offers Fold columns", open?.toggle === "Fold columns" && open?.expanded === "true", open?.toggle),
    ]);
    await tab.click({ role: "button", name: "Fold columns" });
    await tab.page.waitForTimeout(500);
    const refolded = byName(await tables(tab), "wide_records");
    await ctx.verify("Fold columns folds it back", [check("twelve columns and + 5 columns again", names(refolded).length === 12 && refolded?.toggle === "+ 5 columns", [names(refolded).length, refolded?.toggle])]);

    await tab.page.getByRole("button", { name: "+ 5 columns" }).focus();
    await tab.page.keyboard.press("Enter");
    await tab.page.waitForTimeout(500);
    const byKey = byName(await tables(tab), "wide_records");
    await ctx.verify("focus and Enter unfold too", [check("17 columns after Enter on the focused row", names(byKey).length === 17 && byKey?.toggle === "Fold columns", [names(byKey).length, byKey?.toggle])]);

  },
};

/** @type {JourneyDef} */
export const notSaved = {
  id: "folding-is-a-setting-of-your-own-view-and-is-not-saved-with-the-team-layout",
  title: "unfolding a table writes nothing to the shared layout, and a reload or another tab shows the table folded again",
  entryPoint: "/modules/database/diagram?schema=vault",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=vault");
    const names = (/** @type {Node | undefined} */ node) => (node?.rows ?? []).map((row) => row.name);
    await tab.click({ role: "button", name: "+ 5 columns" });
    await tab.page.waitForTimeout(500);
    const foldedLayout = await savedLayout(ctx, "vault");
    await tab.page.waitForTimeout(2000);
    const afterUnfold = await savedLayout(ctx, "vault");
    await ctx.verify("folding is not saved with the team's layout", [check("the layout holds no change after unfolding", JSON.stringify(foldedLayout) === JSON.stringify(afterUnfold), [foldedLayout, afterUnfold])]);

    await tab.reload();
    await ready(tab);
    const again = byName(await tables(tab), "wide_records");
    await ctx.verify("a reload folds it again", [check("the saved layout does not remember the unfolding", names(again).length === 12 && again?.toggle === "+ 5 columns", [names(again).length, again?.toggle])]);

    const other = await openDiagram(ctx, "?schema=vault");
    const fresh = byName(await tables(other), "wide_records");
    await ctx.verify("another tab", [check("it shows the table folded", names(fresh).length === 12 && fresh?.toggle === "+ 5 columns", [names(fresh).length, fresh?.toggle])]);
  },
};

/** @type {JourneyDef} */
export const finding = {
  id: "finding-a-column-a-folded-table-hides-unfolds-that-table",
  title: "searching for a column that is drawn leaves a folded table folded, searching for one it hides unfolds that table alone",
  entryPoint: "/modules/database/diagram?schema=vault search",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=vault");
    const names = (/** @type {Node | undefined} */ node) => (node?.rows ?? []).map((row) => row.name);
    const search = { role: "textbox", name: "Find a table or column" };
    await tab.fill(search, "c01");
    await tab.press("Enter", search);
    await tab.page.waitForTimeout(800);
    const visibleColumn = byName(await tables(tab), "wide_records");
    await ctx.verify("finding a visible column leaves the table folded", [check("still 12 columns", names(visibleColumn).length === 12, names(visibleColumn))]);
    await tab.fill(search, "tail_marker");
    await tab.press("Enter", search);
    await tab.page.waitForTimeout(800);
    const found = byName(await tables(tab), "wide_records");
    await ctx.verify("finding a hidden column unfolds its table", [
      check("wide_records is unfolded and shows tail_marker", names(found).length === 17 && names(found).includes("tail_marker"), names(found)),
      check("the other tables are not touched", byName(await tables(tab), "accounts")?.rows.length === 5, "accounts"),
    ]);
  },
};

/** @type {JourneyDef} */
export const foldRule = {
  id: "the-fold-keeps-the-twelve-column-boundary-and-every-column-an-arrow-ends-on",
  title: "a table of exactly 12 columns is not folded, one of 13 is folded with + 1 column in the singular, and a column an arrow ends on stays drawn beyond the twelfth",
  entryPoint: "/modules/database/diagram?schema=links",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=links");
    const drawn = await tables(tab);
    const names = (/** @type {string} */ table) => (byName(drawn, table)?.rows ?? []).map((row) => row.name);
    await ctx.verify("the boundary", [
      check("twelve columns are all drawn with no fold row", names("twelve_columns").length === 12 && byName(drawn, "twelve_columns")?.toggle === "", [names("twelve_columns").length, byName(drawn, "twelve_columns")?.toggle]),
      check("thirteen columns fold one away", names("thirteen_columns").length === 12 && !names("thirteen_columns").includes("c12") && byName(drawn, "thirteen_columns")?.toggle === "+ 1 column", [names("thirteen_columns"), byName(drawn, "thirteen_columns")?.toggle]),
      check("a column an arrow ends on stays drawn beyond the twelfth", names("anchor_target").join() === "_id,c01,c02,c03,c04,c05,c06,c07,c08,c09,c10,c11,c13" && byName(drawn, "anchor_target")?.toggle === "+ 1 column", [names("anchor_target"), byName(drawn, "anchor_target")?.toggle]),
      check("the hidden column is the one no arrow touches", !names("anchor_target").includes("c12"), names("anchor_target")),
    ]);
    await tab.page.locator('.vue-flow__node[data-id="links::thirteen_columns"] li button').click();
    await tab.page.waitForTimeout(500);
    const unfolded = byName(await tables(tab), "thirteen_columns");
    await ctx.verify("a one-column fold unfolds", [check("thirteen columns and Fold columns", (unfolded?.rows.length ?? 0) === 13 && unfolded?.toggle === "Fold columns" && unfolded.rows.at(-1)?.name === "c12", unfolded?.rows.map((row) => row.name))]);
  },
};

/** @type {JourneyDef} */
export const startView = {
  id: "a-large-schema-opens-at-forty-percent-on-its-top-left-and-fit-view-shows-it-whole",
  title: "a schema too large to fit at a readable zoom opens at 40 % on its top-left corner with the overview map showing the whole, Fit view and 1 frame it all, and a small schema opens fitted",
  entryPoint: "/modules/database/diagram?schema=dms-core",
  async run(ctx) {
    const tab = await openDiagram(ctx, "?schema=dms-core");
    const startZoom = await zoomPercent(tab);
    const canvas = await tab.page.locator(".vue-flow").first().boundingBox();
    const all = await tables(tab);
    const lefts = await Promise.all(all.map(async (node) => (await tab.page.locator(`.vue-flow__node[data-id="${node.id}"]`).first().boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }));
    const minX = Math.min(...lefts.map((entry) => entry.x)) - (canvas?.x ?? 0);
    const minY = Math.min(...lefts.map((entry) => entry.y)) - (canvas?.y ?? 0);
    const maxRight = Math.max(...lefts.map((entry) => entry.x + entry.width)) - (canvas?.x ?? 0);
    const maxBottom = Math.max(...lefts.map((entry) => entry.y + entry.height)) - (canvas?.y ?? 0);
    const minimap = await tab.page.locator(".vue-flow__minimap").first().isVisible();
    await ctx.verify("the large schema", [
      check("it opens at 40 %", startZoom === 40, startZoom),
      check("its top-left corner sits in the top-left of the canvas", minX >= 0 && minX <= 80 && minY >= 40 && minY <= 130, [minX, minY]),
      check("the diagram runs past the canvas, it is not shrunk to fit", maxRight > (canvas?.width ?? 0) || maxBottom > (canvas?.height ?? 0), [maxRight, maxBottom, canvas]),
      check("the overview map is shown", minimap, minimap),
    ]);
    await tab.press("1");
    await tab.page.waitForTimeout(800);
    const fitted = await zoomPercent(tab);
    await tab.page.keyboard.press("0");
    await tab.page.waitForTimeout(800);
    const reset = await zoomPercent(tab);
    await ctx.verify("Fit view and reset zoom", [
      check("1 fits the whole diagram, below the start zoom", fitted < 40, fitted),
      check("0 resets the zoom to 100 %", reset === 100, reset),
    ]);
    await tab.click({ role: "button", name: "Fit view" });
    await tab.page.waitForTimeout(800);
    await ctx.verify("the Fit view button", [check("it fits like 1", (await zoomPercent(tab)) === fitted, await zoomPercent(tab))]);

    const small = await openDiagram(ctx, "?schema=shop", tab);
    const zoom = await zoomPercent(small);
    await ctx.verify("a small schema", [check("it opens fitted, readable and not clipped, not at 40", zoom > 40 && zoom <= 100, zoom)]);
  },
};
