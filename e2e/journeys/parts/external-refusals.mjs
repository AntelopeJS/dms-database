import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { check, db, list, pick, show, tableQuery, text } from "../../database.mjs";
import { DATA_PAGE, openTable, settle } from "./browse.mjs";
import { openReview, typeInto } from "./edit.mjs";
import { accessBar, barReads, ERP, pageText, setAccess, storedCustomer, UNWRITABLE, WRITABLE, withExternal } from "./external-kit.mjs";

/**
 * @typedef {import("../../database.mjs").Ctx} Ctx
 * @typedef {import("../../database.mjs").Tab} Tab
 */

const KEY_UNKNOWN = "$dms_database.connections.unknown";
const SELECTION = "filter_schema=is:erp&filter_table=is:customers&id=c1";

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<void>}
 */
async function connectionRoutes(ctx) {
  const unknown = await db(ctx, "pick an unknown database", "PUT", "/connections/selected", { body: { connection: "nope" } });
  const unknownAccess = await db(ctx, "access of an unknown database", "PUT", "/connections/nope/access", { body: { access: "read" } });
  const unknownRelations = await db(ctx, "relations of an unknown database", "GET", "/connections/nope/relations");
  const own = await db(ctx, "access of the project database", "PUT", "/connections/own/access", { body: { access: "read" } });
  const bad = await db(ctx, "a bad access", "PUT", `/connections/${ERP}/access`, { body: { access: "write" } });
  await ctx.verify("the connection routes refuse what is not theirs", [
    check("an unknown database to pick answers 404 with its key", unknown.status === 404 && unknown.body === KEY_UNKNOWN, show(unknown)),
    check("an access change on an unknown database answers 404 with its key", unknownAccess.status === 404 && unknownAccess.body === KEY_UNKNOWN, show(unknownAccess)),
    check("the relations of an unknown database answer 404 with its key", unknownRelations.status === 404 && unknownRelations.body === KEY_UNKNOWN, show(unknownRelations)),
    check("the project database's access cannot change", own.status === 400 && own.body === "The project's own database is always writable", show(own)),
    check("a bad access answers 400 and names the two it takes", bad.status === 400 && bad.body === 'Expected { access: "read" | "read-write" }', show(bad)),
  ]);
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<void>}
 */
async function unservedRoutes(ctx) {
  await db(ctx, "pick erp", "PUT", "/connections/selected", { body: { connection: ERP } });
  const readOnly = await db(ctx, "edit while read", "PUT", `/browse/edit?${SELECTION}&connection=${ERP}`, { body: { name: "X" } });
  const diagram = await db(ctx, "diagram layout", "GET", "/diagram/layout/erp");
  const drawn = await db(ctx, "save the erp layout", "PUT", `/diagram/layout/erp?connection=${ERP}`, { body: { positions: { customers: { x: 5, y: 6 } } } });
  const drawnBack = await db(ctx, "read the erp layout", "GET", "/diagram/layout/erp");
  await db(ctx, "pick the project database", "PUT", "/connections/selected", { body: { connection: "own" } });
  const ownLayout = await db(ctx, "the project database's layout of a schema named erp", "GET", "/diagram/layout/erp");
  await db(ctx, "pick erp again", "PUT", "/connections/selected", { body: { connection: ERP } });
  await db(ctx, "clear the erp layout", "PUT", `/diagram/layout/erp?connection=${ERP}`, { body: { positions: {} } });
  const execute = await db(ctx, "query", "POST", "/query/execute", { body: { query: tableQuery("erp", "customers"), source: "x", language: "aql" } });
  const references = await db(ctx, "references", "GET", `/browse/references?${SELECTION}`);
  const stored = await storedCustomer(ctx);
  await ctx.verify("the routes answer for an external database", [
    check("a write while the access is read answers 403 with its key and the database", readOnly.status === 403 && pick(readOnly.body, "message") === "$dms_database.data.save.read_only_access" && pick(readOnly.body, "params", "connection") === ERP, show(readOnly)),
    check("the diagram is served: its layout answers 200", diagram.status === 200 && show(pick(diagram.body, "positions")) === "{}", show(diagram)),
    check("the layout of an external database's schema is its own: saved on erp it reads back there and not on the project database's schema of the same name", drawn.status === 200 && show(pick(drawnBack.body, "positions")) === '{"customers":{"x":5,"y":6}}' && show(pick(ownLayout.body, "positions")) === "{}", [show(drawnBack), show(ownLayout)]),
    check("the query console answers 409 and names itself", execute.status === 409 && execute.body === "The query console is not available on an external database", show(execute)),
    check("a row's references answer 409 and name themselves", references.status === 409 && references.body === "A row's references is not available on an external database", show(references)),
    check("the customer was not written", text(stored, "name") === "Ada", show(stored)),
  ]);
}

/**
 * @param {Ctx} ctx The journey
 * @param {Tab} tab A signed-in tab
 * @returns {Promise<void>}
 */
async function lockedPages(ctx, tab) {
  await tab.goto("/modules/database/diagram");
  const diagram = await settle(() => pageText(tab), (content) => /customers\s+_id\s+string/.test(content));
  await tab.goto("/modules/database/query");
  const query = await settle(() => pageText(tab), (content) => /Not available on an external database/.test(content));
  await ctx.verify("the locked pages", [
    check("the Diagram page draws the table of erp with its columns, not a lock", /customers\s+_id\s+string\s+name\s+string\s+segment\s+string/.test(diagram) && !/Not available on an external database/.test(diagram), diagram),
    check("the Query console page says why it has nothing to show", /Not available on an external database/.test(query), query),
  ]);
}

/**
 * A tab edits erp while another tab picks the project database, then saves.
 *
 * @param {Ctx} ctx The journey
 * @param {Tab} tab A tab on erp
 * @returns {Promise<void>}
 */
async function staleTab(ctx, tab) {
  await setAccess(ctx, "read-write");
  await openTable(tab, ERP, "customers");
  await barReads(tab, "Access to erp: Read & write");
  await typeInto(tab, "c1", "name", "Ada Stale");
  await db(ctx, "another tab picks the project database", "PUT", "/connections/selected", { body: { connection: "own" } });
  await openReview(tab);
  await tab.click({ role: "button", name: /^Save \d+ changes?$/ });
  const stale = await settle(() => tab.page.getByRole("dialog").innerText().then((content) => content.replace(/\s+/g, " ")), (content) => /changed in another tab/.test(content));
  await ctx.verify("a stale tab", [check("the refusal reads The selected database changed in another tab: reload the page.", /The selected database changed in another tab: reload the page\./.test(stale) && !/\$dms_database/.test(stale), stale)]);
  await tab.click({ role: "button", name: "Keep editing" });
  await tab.click({ role: "button", name: "Discard", exact: true });
  await db(ctx, "pick erp again", "PUT", "/connections/selected", { body: { connection: ERP } });
  const kept = await storedCustomer(ctx);
  await ctx.verify("the stale save wrote nothing", [check("the customer is as it was", text(kept, "name") === "Ada", show(kept))]);
}

/**
 * The access switch on a project file the writer cannot rewrite.
 *
 * @param {Ctx} ctx The journey
 * @param {Tab} tab A tab on erp
 * @param {string} root The project the writer rewrites
 * @returns {Promise<void>}
 */
async function unwritableProject(ctx, tab, root) {
  const file = join(root, "antelope.config.ts");
  await setAccess(ctx, "read");
  await writeFile(file, UNWRITABLE);
  await tab.goto(DATA_PAGE);
  await barReads(tab, "Access to erp: Read only");
  await tab.click({ role: "switch", name: `Allow changes to ${ERP}` });
  await tab.click({ role: "button", name: "Allow changes" });
  const refusal = await settle(() => pageText(tab), (content) => /configuration refused the change/.test(content));
  const bar = await accessBar(tab);
  const after = list((await db(ctx, "connections", "GET", "/connections")).body, "connections").find((row) => text(row, "id") === ERP);
  await ctx.verify("a project file the writer cannot rewrite", [
    check("the switch says the configuration refused the change and why", /The project's configuration refused the change: .+/.test(refusal) && !/\$dms_database/.test(refusal), refusal),
    check("the bar and the API keep Read only", bar === "Access to erp: Read only" && text(after, "access") === "read", [bar, show(after)]),
    check("the file was not rewritten", (await readFile(file, "utf8")) === UNWRITABLE, await readFile(file, "utf8")),
  ]);
}

/** What an external database refuses, and the sentences that say so. */
export const refusalJourneys = [
  {
    id: "an-external-database-refuses-what-it-cannot-serve-with-sentences",
    title:
      "on an external database each refusal reads as a sentence: the query console and a row's references are locked and their routes answer 409, the diagram is drawn from the catalog with a layout of its own, a stale tab and a save while the access is read are refused in the user's language, a project file the writer cannot rewrite is refused with its reason, and an unknown database or a bad body is refused by the API",
    entryPoint: "/modules/database/diagram and /query on an external database, PUT /connections/*, PUT /browse/edit, the access switch",
    backend: "dev",
    async run(/** @type {Ctx} */ ctx) {
      await withExternal(ctx, WRITABLE, async (root) => {
        await connectionRoutes(ctx);
        await unservedRoutes(ctx);
        const tab = await ctx.tab();
        await tab.signIn("admin");
        await lockedPages(ctx, tab);
        await staleTab(ctx, tab);
        await unwritableProject(ctx, tab, root);
      });
    },
  },
];
