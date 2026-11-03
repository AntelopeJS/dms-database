import { guarded } from "../guard.mjs";
import { check, db, list, member, pick, runQuery, tableQuery, text } from "../database.mjs";
import { editorText, flat, openConsole, runSource } from "./parts/console.mjs";

/** @typedef {import("../database.mjs").Ctx} Ctx */
/** @typedef {import("../database.mjs").Tab} Tab */

const SLICE = (/** @type {number} */ end) => ({ stage: "slice", args: [0, end] });
const TAGS_QUERY = tableQuery("demo", "tags");
const TAGS_SOURCE = 'schemas.demo.instance().table("tags")';
const HISTORY_LIMIT = 500;

/**
 * The runs of an account, newest first.
 *
 * @param {Ctx} ctx The journey
 * @param {string} [as] The account
 * @param {string} [query] A query string for paging
 * @returns {Promise<{ items: import("../database.mjs").Row[], total: unknown, status: number | null }>} The page
 */
async function history(ctx, as, query = "limit=500") {
  const answer = await db(ctx, `history of ${as ?? "admin"}`, "GET", `/query/history?${query}`, { as });
  return { items: list(answer.body, "items"), total: pick(answer.body, "total"), status: answer.status };
}

/**
 * Saves a query through the API.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The name
 * @param {boolean} shared Whether it is shared
 * @param {string} [as] The account
 * @returns {Promise<import("../database.mjs").Answer>} The answer
 */
function save(ctx, name, shared, as) {
  return db(ctx, `save ${name}`, "POST", "/query/saved", { body: { name, description: `about ${name}`, query: TAGS_QUERY, source: TAGS_SOURCE, language: "aql", shared }, as });
}

/**
 * The library tab of the console.
 *
 * @param {Tab} tab The tab
 * @param {string} name History, Saved or Team
 */
async function libraryTab(tab, name) {
  await tab.page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
  await tab.page.waitForTimeout(800);
}

/** History, saved queries and team queries. */
export const journeys = guarded([
  {
    id: "history-keeps-your-last-500-runs-newest-first",
    title: "after 503 runs the history holds exactly 500, newest first, the three oldest are gone and no run can be read back by id; the console says 'Your last 500 runs are kept.'",
    entryPoint: "POST /api/database/query/execute, GET /query/history, /modules/database/query",
    async run(/** @type {Ctx} */ ctx) {
      const total = HISTORY_LIMIT + 3;
      for (let index = 1; index <= total; index += 1) {
        const run = await runQuery(ctx, `${TAGS_SOURCE}.slice(0, ${index})`, tableQuery("demo", "tags", [SLICE(index)]));
        if (run.status !== 200) throw new Error(`run ${index} answered ${run.status}`);
      }
      const page = await history(ctx);
      const sources = page.items.map((item) => text(item, "source"));
      const first = await history(ctx, undefined, "limit=1");
      const second = await history(ctx, undefined, "limit=2&offset=1");
      const beyond = await history(ctx, undefined, "limit=1000");
      await ctx.verify("the cap", [
        check("500 runs are listed and counted", page.items.length === HISTORY_LIMIT && page.total === HISTORY_LIMIT, [page.items.length, page.total]),
        check("the newest run is first", sources[0] === `${TAGS_SOURCE}.slice(0, ${total})`, sources[0]),
        check("the oldest kept run is the fourth", sources.at(-1) === `${TAGS_SOURCE}.slice(0, 4)`, sources.at(-1)),
        check("the three oldest are gone", !sources.some((source) => /slice\(0, [123]\)$/.test(source)), sources.slice(-3)),
        check("limit 1 gives the newest and offset pages on", text(first.items[0], "source") === sources[0] && text(second.items[0], "source") === sources[1] && second.items.length === 2, [first.items.length, second.items.length]),
        check("a limit above 500 is cut to 500", beyond.items.length === HISTORY_LIMIT, beyond.items.length),
      ]);
      const tab = await openConsole(ctx);
      const body = flat(await tab.page.locator("body").innerText());
      await ctx.verify("the console", [check("it states the cap", body.includes("Your last 500 runs are kept."), body.slice(0, 600))]);
    },
  },
  {
    id: "history-records-failures-and-writes-with-their-status",
    title: "a failed run is kept with status error and its message, a write is kept as a mutation, a read as ok with its row count; the library lists them under Today with 'N ms · N rows' or the error",
    entryPoint: "POST /api/database/query/execute, GET /query/history",
    async run(/** @type {Ctx} */ ctx) {
      await runQuery(ctx, TAGS_SOURCE, TAGS_QUERY);
      await runQuery(ctx, 'schemas.demo.instance().table("nope")', tableQuery("demo", "nope"));
      await runQuery(ctx, `${TAGS_SOURCE}.insert([{name: "w"}])`, tableQuery("demo", "tags", [{ stage: "insert", args: [[{ name: "w" }]] }]));
      const { items } = await history(ctx);
      const [write, failed, read] = items;
      await ctx.verify("the entries", [
        check("the read is ok with 3 rows and no mutation", pick(read, "status") === "ok" && pick(read, "rowCount") === 3 && pick(read, "mutation") === false, read),
        check("the failure is an error that keeps its message", pick(failed, "status") === "error" && text(failed, "error") === 'Unknown table "nope" in schema demo' && pick(failed, "mutation") === false, failed),
        check("the write is a mutation of one row", pick(write, "status") === "ok" && pick(write, "mutation") === true && pick(write, "rowCount") === 1, write),
      ]);
      const tab = await openConsole(ctx);
      const body = flat(await tab.page.locator("body").innerText());
      await ctx.verify("the library", [
        check("grouped under Today", /TODAY|Today/.test(body), body.slice(0, 400)),
        check("a read shows its duration and rows", /demo\.tags schemas\.demo\.instance\(\)\.table\("tags"\) \d\d:\d\d [AP]M · \d+ ms · 3 rows/.test(body), body.slice(200, 900)),
        check("a failure shows its message", body.includes('demo.nope schemas.demo.instance().table("nope") Unknown table "nope" in schema demo'), body.slice(200, 900)),
        check("a write shows what it changed", /· 1 changed/.test(body), body.slice(200, 900)),
      ]);
    },
  },
  {
    id: "history-is-searchable-and-clearing-it-keeps-the-saved-queries",
    title: "the library search narrows the history; Clear history asks first, Cancel keeps it, Clear history empties it and leaves the saved queries",
    entryPoint: "/modules/database/query, DELETE /api/database/query/history",
    async run(/** @type {Ctx} */ ctx) {
      await runQuery(ctx, TAGS_SOURCE, TAGS_QUERY);
      await runQuery(ctx, 'schemas.demo.instance().table("posts")', tableQuery("demo", "posts"));
      await save(ctx, "Kept", false);
      const tab = await openConsole(ctx);
      await tab.page.getByRole("textbox", { name: "Search queries" }).fill("posts");
      await tab.page.waitForTimeout(800);
      const narrowed = flat(await tab.page.locator("body").innerText()).split("Your last 500")[0] ?? "";
      await ctx.verify("search", [check("only the posts run is listed", narrowed.includes('table("posts")') && !narrowed.includes('table("tags")'), narrowed.slice(200, 800))]);
      await tab.page.getByRole("textbox", { name: "Search queries" }).fill("zzz");
      await tab.page.waitForTimeout(800);
      await ctx.verify("search without a match", [tab.shows(/No query matches\./)]);
      await tab.page.getByRole("textbox", { name: "Search queries" }).fill("");
      await tab.page.getByRole("button", { name: "Clear history" }).click();
      await tab.page.waitForTimeout(500);
      const dialog = flat((await tab.page.getByRole("dialog").allInnerTexts()).join(" | "));
      await ctx.verify("the question", [check("it names what goes and what stays", dialog.includes("Clear your query history?") && dialog.includes("Your past runs are removed. Saved queries stay."), dialog)]);
      await tab.page.getByRole("button", { name: "Cancel", exact: true }).click();
      await tab.page.waitForTimeout(500);
      await ctx.verify("Cancel", [check("both runs are kept", (await history(ctx)).items.length === 2, "history")]);
      await tab.page.getByRole("button", { name: "Clear history" }).click();
      await tab.page.getByRole("button", { name: "Clear history", exact: true }).last().click();
      await tab.page.waitForTimeout(1500);
      const saved = await db(ctx, "saved", "GET", "/query/saved");
      await ctx.verify("Clear history", [check("the history is empty", (await history(ctx)).items.length === 0, "history"), check("the saved query stays", list(saved.body, "items").length === 1 && text(list(saved.body, "items")[0], "name") === "Kept", saved.body), tab.shows(/Queries you run show up here\./)]);
    },
  },
  {
    id: "a-saved-query-needs-a-name-and-can-be-edited-and-deleted",
    title: "Save asks for a name, keeps the description, lists the query under Saved, restores it into the editor, can be edited and, after a confirmation, deleted",
    entryPoint: "/modules/database/query, Ctrl+S, POST/PUT/DELETE /api/database/query/saved",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      await runSource(tab, `${TAGS_SOURCE}.slice(0, 2)`);
      await tab.page.getByRole("textbox", { name: "Query editor (AQL)" }).press("Control+s");
      await tab.page.waitForTimeout(800);
      const opened = flat((await tab.page.getByRole("dialog").allInnerTexts()).join(" | "));
      await ctx.verify("Ctrl+S", [check("the Save query dialog opens", opened.includes("Save query") && opened.includes("Saved queries appear under Saved, and under Team when shared."), opened)]);
      const none = await db(ctx, "saved before", "GET", "/query/saved");
      await ctx.verify("no name", [tab.enabled({ role: "button", name: "Save query", exact: true }, { disabled: true }), check("nothing is saved", list(none.body, "items").length === 0, none.body)]);
      await tab.page.getByRole("textbox", { name: "Name" }).fill("Two tags");
      await tab.page.getByRole("textbox", { name: "Description" }).fill("the first two");
      await tab.page.getByRole("button", { name: "Save query", exact: true }).last().click();
      await tab.page.waitForTimeout(1500);
      const saved = list((await db(ctx, "saved", "GET", "/query/saved")).body, "items");
      await ctx.verify("saved", [check("one private query with its name, description and source", saved.length === 1 && text(saved[0], "name") === "Two tags" && text(saved[0], "description") === "the first two" && text(saved[0], "source") === `${TAGS_SOURCE}.slice(0, 2)` && pick(saved[0], "shared") === false, saved), tab.shows(/“Two tags” saved/)]);
      await libraryTab(tab, "Saved");
      await tab.page.getByRole("button", { name: "New", exact: true }).click();
      await tab.page.getByText("Two tags", { exact: true }).first().click();
      await tab.page.waitForTimeout(800);
      await ctx.verify("restore", [check("the query is back in the editor", (await editorText(tab)) === `${TAGS_SOURCE}.slice(0, 2)`, await editorText(tab))]);
      const id = text(saved[0], "id");
      const edited = await db(ctx, "edit", "PUT", `/query/saved/${id}`, { body: { name: "Two tags v2", description: "edited", query: TAGS_QUERY, source: TAGS_SOURCE, language: "aql", shared: false } });
      const after = list((await db(ctx, "saved after edit", "GET", "/query/saved")).body, "items");
      await ctx.verify("edit", [check("the same query holds the new name", edited.status === 200 && after.length === 1 && text(after[0], "id") === id && text(after[0], "name") === "Two tags v2" && text(after[0], "source") === TAGS_SOURCE, after)]);
      await tab.reload();
      await tab.page.waitForTimeout(3000);
      await libraryTab(tab, "Saved");
      await tab.page.getByRole("button", { name: "Delete", exact: true }).first().click({ force: true });
      await tab.page.waitForTimeout(600);
      const confirm = flat((await tab.page.getByRole("dialog").allInnerTexts()).join(" | "));
      await ctx.verify("delete asks", [check("it names the query", confirm.includes("Delete “Two tags v2”?"), confirm)]);
      await tab.page.getByRole("button", { name: "Delete query", exact: true }).last().click();
      await tab.page.waitForTimeout(1500);
      await ctx.verify("deleted", [check("the library is empty", list((await db(ctx, "saved final", "GET", "/query/saved")).body, "items").length === 0, "saved")]);
    },
  },
  {
    id: "a-shared-query-reaches-the-team-and-only-its-author-changes-it",
    title: "a query shared with the team shows under Team for a teammate, who can run it but gets 404 on editing or deleting it; a private query stays out of Team; the author deleting it removes it for the teammate",
    entryPoint: "/modules/database/query Team tab, GET /query/saved?scope=shared, PUT/DELETE /query/saved/:id",
    async run(/** @type {Ctx} */ ctx) {
      await member(ctx, "mate", [], true);
      const shared = await save(ctx, "For the team", true);
      await save(ctx, "Mine only", false);
      const id = text(shared.body, "id");
      const team = list((await db(ctx, "team as mate", "GET", "/query/saved?scope=shared", { as: "mate" })).body, "items");
      const own = list((await db(ctx, "saved as mate", "GET", "/query/saved", { as: "mate" })).body, "items");
      await ctx.verify("the teammate's view", [
        check("Team holds the shared query with its author's name", team.length === 1 && text(team[0], "name") === "For the team" && text(team[0], "ownerName") !== "", team),
        check("the private query is not shared", !JSON.stringify(team).includes("Mine only"), team),
        check("the teammate's own Saved is empty", own.length === 0, own),
      ]);
      const edit = await db(ctx, "edit as mate", "PUT", `/query/saved/${id}`, { as: "mate", body: { name: "Hijacked", description: "", query: TAGS_QUERY, source: TAGS_SOURCE, language: "aql", shared: true } });
      const remove = await db(ctx, "delete as mate", "DELETE", `/query/saved/${id}`, { as: "mate" });
      const intact = list((await db(ctx, "saved as admin", "GET", "/query/saved")).body, "items").find((row) => text(row, "id") === id);
      await ctx.verify("only the author changes it", [check("editing answers 404", edit.status === 404, edit.status), check("deleting answers 404", remove.status === 404, remove.status), check("the query is intact", text(intact, "name") === "For the team", intact)]);
      const tab = await ctx.tab("mate");
      await tab.signIn("mate");
      await tab.goto("/modules/database/query");
      await tab.page.waitForTimeout(3000);
      await libraryTab(tab, "Team");
      await tab.page.getByText("For the team", { exact: true }).first().click();
      await tab.page.waitForTimeout(800);
      await ctx.verify("the teammate runs it", [check("it fills the editor", (await editorText(tab)) === TAGS_SOURCE, await editorText(tab)), check("the library shows it as shared", flat(await tab.page.locator("body").innerText()).includes("For the team"), "Team")]);
      await db(ctx, "delete as author", "DELETE", `/query/saved/${id}`);
      const gone = list((await db(ctx, "team after delete", "GET", "/query/saved?scope=shared", { as: "mate" })).body, "items");
      await ctx.verify("the author deletes it", [check("the Team tab no longer lists it", gone.length === 0, gone)]);
    },
  },
  {
    id: "history-belongs-to-its-user-and-a-link-restores-a-run",
    title: "a teammate's history is empty and the owner's run answers 404 to them; ?history=<id> restores that run's query into the editor",
    entryPoint: "GET /query/history, /query/history/:id, /modules/database/query?history=",
    async run(/** @type {Ctx} */ ctx) {
      await member(ctx, "mate", [], true);
      await runQuery(ctx, `${TAGS_SOURCE}.slice(0, 2)`, tableQuery("demo", "tags", [SLICE(2)]));
      const mine = await history(ctx);
      const id = text(mine.items[0], "id");
      const theirs = await history(ctx, "mate");
      const peek = await db(ctx, "their read of my run", "GET", `/query/history/${id}`, { as: "mate" });
      const own = await db(ctx, "my read of my run", "GET", `/query/history/${id}`);
      await ctx.verify("per user", [
        check("the teammate has no history", theirs.items.length === 0 && theirs.total === 0, theirs),
        check("the teammate cannot read the owner's run", peek.status === 404, peek.status),
        check("the owner reads it with its source", own.status === 200 && text(own.body, "source") === `${TAGS_SOURCE}.slice(0, 2)`, own.body),
      ]);
      const tab = await openConsole(ctx, `/modules/database/query?history=${id}`);
      await tab.page.waitForTimeout(2000);
      await ctx.verify("the link", [check("the run's query is in the editor", (await editorText(tab)) === `${TAGS_SOURCE}.slice(0, 2)`, await editorText(tab))]);
    },
  },
  {
    id: "the-library-survives-a-backend-restart",
    title: "history and saved queries are stored in the module's own tables, so they are still there after the backend restarts",
    entryPoint: "GET /query/history, /query/saved after a restart",
    async run(/** @type {Ctx} */ ctx) {
      await runQuery(ctx, TAGS_SOURCE, TAGS_QUERY);
      await save(ctx, "Durable", true);
      await ctx.restartBackend();
      const runs = await history(ctx);
      const saved = list((await db(ctx, "saved after restart", "GET", "/query/saved")).body, "items");
      await ctx.verify("after the restart", [check("the run is kept", runs.items.length === 1 && text(runs.items[0], "source") === TAGS_SOURCE, runs.items), check("the saved query is kept, still shared", saved.length === 1 && text(saved[0], "name") === "Durable" && pick(saved[0], "shared") === true, saved)]);
    },
  },
]);
