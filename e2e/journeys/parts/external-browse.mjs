import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { check, db, list, pick, show, text } from "../../database.mjs";
import { DATA_PAGE, openTable, settle } from "./browse.mjs";
import { cellState, openReview, reviewLabel, saveStaged, typeInto } from "./edit.mjs";
import {
  accessBar,
  barReads,
  closeTabs,
  disabledLink,
  ERP,
  lockedEntry,
  pageText,
  pickDatabase,
  recentEntries,
  setAccess,
  storedCustomer,
  WRITABLE,
  withExternal,
} from "./external-kit.mjs";

/**
 * @typedef {import("../../database.mjs").Ctx} Ctx
 * @typedef {import("../../database.mjs").Tab} Tab
 */

const READ_ONLY = "Access to erp: Read only";
const READ_WRITE = "Access to erp: Read & write";

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The open dialog's text on one line
 */
async function dialogText(tab) {
  return (await tab.page.getByRole("dialog").innerText()).replace(/\s+/g, " ");
}

/**
 * Turns on the access switch and confirms.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<void>}
 */
async function allowChanges(tab) {
  await tab.click({ role: "switch", name: `Allow changes to ${ERP}` });
  await tab.click({ role: "button", name: "Allow changes" });
  await barReads(tab, READ_WRITE);
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<void>}
 */
async function listing(ctx) {
  const listed = await db(ctx, "connections", "GET", "/connections");
  const rows = list(listed.body, "connections");
  const erp = rows.find((row) => text(row, "id") === ERP);
  const unsupported = pick(erp, "unsupported");
  await ctx.verify("the console lists erp next to the project database", [
    check("the project database is listed first", text(rows[0], "kind") === "own", show(listed.body)),
    check("erp is external, on MongoDB, read only", text(erp, "kind") === "external" && text(erp, "engine") === "mongodb" && text(erp, "access") === "read", show(erp)),
    check("erp has no diagram, query console, instances or references", Array.isArray(unsupported) && ["diagram", "queryConsole", "instances", "rowReferences"].every((feature) => unsupported.includes(feature)), show(unsupported)),
  ]);
}

/**
 * @param {Ctx} ctx The journey
 * @param {Tab} tab A signed-in tab on the project database
 * @returns {Promise<void>}
 */
async function switching(ctx, tab) {
  await tab.goto(DATA_PAGE);
  const menu = await pickDatabase(tab, "Project database", ERP);
  await ctx.verify("the switcher", [
    check("the menu lists the project database and erp with its engine, its Read only access and its External badge", /Project database\s+This project\s+erp\s+mongodb\s*·\s*Read only\s+External/i.test(menu), menu),
    check("the sidebar entry of the Diagram is locked with its reason", (await lockedEntry(tab, "Diagram")) === true, "Diagram"),
    check("the sidebar entry of the Query console is locked with its reason", (await lockedEntry(tab, "Query console")) === true, "Query console"),
  ]);
}

/**
 * @param {Ctx} ctx The journey
 * @param {Tab} tab A tab on erp
 * @returns {Promise<void>}
 */
async function dataBrowser(ctx, tab) {
  await openTable(tab, ERP, "customers");
  const grid = await settle(() => pageText(tab), (content) => /customers\s+3 rows/.test(content) && /Linus/.test(content));
  const cell = await cellState(tab, "c1", "name");
  await ctx.verify("the Data browser reads customers", [
    check("three rows, one table in the sidebar", /customers\s+3 rows/.test(grid) && /Tables · 1/i.test(grid) && ["Ada", "Grace", "Linus"].every((name) => grid.includes(name)), grid),
    check("no instance picker and no 'Counts for instance' footer", !/Counts for instance/.test(grid) && !/\bINSTANCE\b/i.test(grid), grid),
    check("the bar says Access to erp: Read only", (await barReads(tab, READ_ONLY)) === READ_ONLY, await accessBar(tab)),
    check("a cell says why it takes no edit", cell.title === "Access to erp is read only.", cell),
  ]);
  await tab.page.locator('tbody tr:has(span:text-is("c1"))').first().locator("td").nth(2).dblclick();
  await ctx.verify("a read-only cell opens no editor", [tab.visible({ role: "textbox", name: "Value of name" }, { hidden: true, timeoutMs: 2_000 })]);
}

/**
 * @param {Ctx} ctx The journey
 * @param {Tab} tab A tab on erp
 * @returns {Promise<void>}
 */
async function schemas(ctx, tab) {
  await tab.goto("/modules/database/schemas");
  await tab.visible({ role: "button", name: "Actions for customers" }, { timeoutMs: 60_000 });
  const page = await pageText(tab);
  const diagramLocked = await disabledLink(tab, "Diagram");
  await tab.click({ role: "button", name: "Actions for customers" });
  const actions = await tab.page.getByRole("menuitem").allInnerTexts();
  await tab.press("Escape");
  await tab.click({ role: "row", name: /customers/ });
  await tab.visible({ role: "tab", name: "Sample row" }, { timeoutMs: 30_000 });
  const inspector = await settle(() => dialogText(tab), (content) => /Table 1 of 1/.test(content));
  const browseLink = await tab.page.getByRole("link", { name: "Browse data" }).last().getAttribute("href");
  await tab.click({ role: "tab", name: "Sample row" });
  const sample = await settle(() => dialogText(tab), (content) => /"_id": "c1"/.test(content));
  await ctx.verify("Schemas and the inspector", [
    check("the table list holds the one table of erp", /Tables\s+1\b/i.test(page) && /customers/.test(page) && /\berp\b/.test(page), page),
    check("the header Diagram link is locked", diagramLocked, "Diagram"),
    check("the row actions offer Inspect and Browse data only", show(actions) === '["Inspect","Browse data"]', actions),
    check("the inspector says 3 rows, 3 columns, with no instance badge", /3 rows/.test(inspector) && /3 columns/.test(inspector) && !/\binstances?\b/i.test(inspector), inspector),
    check("Browse data leads to the table", browseLink === "/modules/database/data?schema=erp&table=customers", browseLink),
    check("the sample row is the first customer, as JSON, with no instance in its position", /ROW 1 OF 3(?! ·)/i.test(sample) && /"name": "Ada"/.test(sample) && !/default/i.test(sample), sample),
  ]);
}

/**
 * @param {Ctx} ctx The journey
 * @param {Tab} tab A tab on erp
 * @returns {Promise<void>}
 */
async function overview(ctx, tab) {
  await tab.goto("/modules/database/overview");
  const page = await settle(() => pageText(tab), (content) => /Healthy/.test(content) && /customers/.test(content));
  await ctx.verify("the Overview", [
    check("the Query console link is locked", await disabledLink(tab, "Open query console"), "Open query console"),
    check("it counts the one table and its three rows", /Tables\s+1\s+in 1 schema/i.test(page) && /Rows\s+3\b/i.test(page), page),
    check("it names no instance on an external database", !/\binstances?\b/i.test(page), page),
  ]);
}

/**
 * @param {Ctx} ctx The journey
 * @param {Tab} tab A tab on erp
 * @param {string} root The project the writer rewrites
 * @returns {Promise<void>}
 */
async function accessSwitch(ctx, tab, root) {
  const file = join(root, "antelope.config.ts");
  await openTable(tab, ERP, "customers");
  await tab.click({ role: "switch", name: `Allow changes to ${ERP}` });
  await tab.visible({ role: "dialog", name: `Allow changes to ${ERP}?` });
  const confirmation = await pageText(tab);
  await tab.click({ role: "button", name: "Keep read only" });
  const kept = await barReads(tab, READ_ONLY);
  await ctx.verify("the confirmation", [
    check("it warns that the database is the customer's live one and that the DMS cannot undo a change", /erp is your customer's live database\. Changes you save are written to it at once, and the DMS cannot undo them\./.test(confirmation), confirmation),
    check("Keep read only writes nothing", kept === READ_ONLY && (await readFile(file, "utf8")) === WRITABLE, kept),
  ]);
  await allowChanges(tab);
  const configured = await readFile(file, "utf8");
  const after = list((await db(ctx, "connections after the switch", "GET", "/connections")).body, "connections").find((row) => text(row, "id") === ERP);
  await ctx.verify("the access switch", [
    check("the bar reads Read & write", (await accessBar(tab)) === READ_WRITE, await accessBar(tab)),
    check("the project's configuration holds read-write for erp", /erp: \{ access: "read-write" \}/.test(configured), configured),
    check("the API follows it", text(after, "access") === "read-write", show(after)),
  ]);
}

/**
 * @param {Ctx} ctx The journey
 * @param {Tab} tab A tab on erp, the access read-write
 * @returns {Promise<void>}
 */
async function saveWhileRead(ctx, tab) {
  await typeInto(tab, "c1", "name", "Ada L");
  const staged = await settle(() => reviewLabel(tab), (label) => label === "Review and save 1 change");
  const revoked = await setAccess(ctx, "read");
  const review = await openReview(tab);
  await tab.click({ role: "button", name: /^Save \d+ changes?$/ });
  const refused = await settle(() => dialogText(tab), (content) => /Access to erp is read only\./.test(content));
  const untouched = await storedCustomer(ctx);
  await ctx.verify("a save while the access is read", [
    check("the edit is staged", staged === "Review and save 1 change", staged),
    check("the access went back to read", revoked.status === 200 && text(list(revoked.body, "connections").find((row) => text(row, "id") === ERP), "access") === "read", show(revoked.body)),
    check("the review names the table", /Save 1 change to customers\?/.test(review) && /It is written to erp\.customers/.test(review), review),
    check("the refusal is the sentence Access to erp is read only., not a key or a generic error", /Access to erp is read only\./.test(refused) && !/\$dms_database/.test(refused), refused),
    check("nothing was written", text(untouched, "name") === "Ada", show(untouched)),
  ]);
  await tab.click({ role: "button", name: "Keep editing" });
  await tab.click({ role: "button", name: "Discard", exact: true });
}

/**
 * @param {Ctx} ctx The journey
 * @param {Tab} tab A tab on erp, the access read
 * @returns {Promise<void>}
 */
async function saveWhileWritable(ctx, tab) {
  await tab.reload();
  const reloaded = await barReads(tab, READ_ONLY);
  await allowChanges(tab);
  await typeInto(tab, "c1", "name", "Ada L");
  const saved = await saveStaged(tab);
  const stored = await settle(() => storedCustomer(ctx), (row) => text(row, "name") === "Ada L");
  const shown = await cellState(tab, "c1", "name");
  await tab.click({ role: "switch", name: `Allow changes to ${ERP}` });
  const back = await barReads(tab, READ_ONLY);
  await ctx.verify("a save while the access is read-write", [
    check("a reload shows the access the configuration holds", reloaded === READ_ONLY, reloaded),
    check("the review is written to erp.customers", /Save 1 change to customers\?/.test(saved) && /Ada → Ada L/.test(saved), saved),
    check("the review names no instance on an external database", !/@/.test(saved), saved),
    check("the stored row changed and no other field", text(stored, "name") === "Ada L" && text(stored, "segment") === "retail", show(stored)),
    check("the grid shows the new name", /Ada L/.test(shown.text), shown),
    check("going back to Read only asks nothing and the bar follows", back === READ_ONLY, back),
  ]);
}

/**
 * @param {Ctx} ctx The journey
 * @param {Tab} tab A tab on erp
 * @returns {Promise<void>}
 */
async function tabsAndRecents(ctx, tab) {
  await openTable(tab, ERP, "customers");
  await closeTabs(tab);
  const offered = await settle(() => recentEntries(tab), (entries) => entries.length === 1);
  await pickDatabase(tab, ERP, "Project database");
  await tab.goto(DATA_PAGE);
  const own = await settle(() => pageText(tab), (content) => /Pick a table to browse/.test(content));
  await ctx.verify("back on the project database", [
    check("the switcher names it and the access bar is gone", (await accessBar(tab)) === "" && /Database\s+This project\s+Project database/i.test(own), own),
    check("it lists its own schema, not erp", /\bdemo\b/.test(own) && !/customers/.test(own), own),
    check("the tab of erp was left behind", (await tab.page.getByRole("button", { name: "Close tab" }).count()) === 0, own),
    check("erp's recent table is not offered on the project database", !/Recently opened/.test(own), own),
    check("erp had offered customers", show(offered) === '["erp.customers"]', offered),
  ]);
  await openTable(tab, "demo", "tags");
  await closeTabs(tab);
  const ownRecent = await settle(() => recentEntries(tab), (entries) => entries.length === 1);
  await pickDatabase(tab, "Project database", ERP);
  await tab.goto(DATA_PAGE);
  const back = await settle(() => recentEntries(tab), (entries) => entries.length >= 1);
  const backText = await pageText(tab);
  await tab.reload();
  const reloaded = await settle(() => pageText(tab), (content) => /Access to erp/.test(content));
  await ctx.verify("tabs and recents follow each database", [
    check("the project database offers demo.tags", show(ownRecent) === '["demo.tags"]', ownRecent),
    check("erp offers customers again and not demo.tags", show(back) === '["erp.customers"]', back),
    check("no read of the other database's table fails", !/Couldn't load/.test(backText) && !/Couldn't load/.test(reloaded), backText),
    check("a reload keeps erp selected", /Database\s+mongodb\s+erp/i.test(reloaded) && /Access to erp: Read only/.test(reloaded), reloaded),
  ]);
}

/** The console on an external database: picked, browsed, edited and left. */
export const browseJourneys = [
  {
    id: "an-external-database-is-picked-browsed-edited-and-left",
    title:
      "with an erp external database listed, the owner picks it in the switcher, browses customers, opens the inspector, its sample row and the locked links, fails to save while the access is read, flips the access switch and saves, switches back to the project database and reloads, and tabs and recents follow each database",
    entryPoint: "/modules/database/data, /schemas and /overview on an external database, GET /api/database/connections, PUT /connections/erp/access",
    backend: "dev",
    async run(/** @type {Ctx} */ ctx) {
      await withExternal(ctx, WRITABLE, async (root) => {
        await listing(ctx);
        const tab = await ctx.tab();
        await tab.signIn("admin");
        await switching(ctx, tab);
        await dataBrowser(ctx, tab);
        await schemas(ctx, tab);
        await overview(ctx, tab);
        await accessSwitch(ctx, tab, root);
        await saveWhileRead(ctx, tab);
        await saveWhileWritable(ctx, tab);
        await tabsAndRecents(ctx, tab);
      });
    },
    knownFailures: {
      "the review names no instance on an external database": "the save review reads 'It is written to erp.customers @default.' though an external database has no instances",
      "it names no instance on an external database": "the Overview counts 1 instance on the erp schema card and reads rows 'in the default instances', though an external database has no instances (#183 dropped the labels of the inspector and the Data browser only)",
    },
  },
];
