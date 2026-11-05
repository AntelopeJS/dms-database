import { guarded } from "../guard.mjs";
import { check, db, list, member, pick, runQuery, tableQuery, text } from "../database.mjs";
import { flat, openConsole } from "./parts/console.mjs";
import { HISTORY_LIMIT, SLICE, TAGS_QUERY, TAGS_SOURCE, history, save } from "./parts/library-kit.mjs";
import { savedJourneys } from "./parts/library-saved.mjs";

/** @typedef {import("../database.mjs").Ctx} Ctx */
/** @typedef {import("../database.mjs").Tab} Tab */
/** History: the last 500 runs and what each keeps. */
const historyJourneys = guarded([
  {
    id: "history-keeps-your-last-500-runs-newest-first",
    title: "after 503 runs the history holds exactly 500, newest first, the three oldest are gone and no run can be read back by id; the console says 'Your last 500 runs are kept.'",
    entryPoint: "POST /api/database/query/execute, GET /query/history, /modules/database/query",
    async run(/** @type {Ctx} */ ctx) {
      const total = HISTORY_LIMIT + 3;
      await member(ctx, "mate", [], true);
      await runQuery(ctx, `${TAGS_SOURCE}.count()`, tableQuery("demo", "tags", [{ stage: "count", args: [], options: {} }]), "mate");
      await runQuery(ctx, TAGS_SOURCE, TAGS_QUERY, "mate");
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
        check("the cap is per user: the teammate's two runs are all still there", (await history(ctx, "mate")).items.length === 2, (await history(ctx, "mate")).items.length),
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
    id: "clear-history-empties-only-your-own-runs",
    title: "with two owners who each ran queries, Clear history of one removes only that owner's runs; the other's history, with its runs and its count, is untouched, and the same holds the other way round",
    entryPoint: "/modules/database/query Clear history, DELETE /api/database/query/history",
    async run(/** @type {Ctx} */ ctx) {
      await member(ctx, "mate", [], true);
      await runQuery(ctx, `${TAGS_SOURCE}.slice(0, 1)`, tableQuery("demo", "tags", [SLICE(1)]), "mate");
      await runQuery(ctx, `${TAGS_SOURCE}.slice(0, 2)`, tableQuery("demo", "tags", [SLICE(2)]), "mate");
      await runQuery(ctx, `${TAGS_SOURCE}.slice(0, 3)`, tableQuery("demo", "tags", [SLICE(3)]));
      const tab = await openConsole(ctx);
      await tab.page.getByRole("button", { name: "Clear history" }).click();
      await tab.page.waitForTimeout(500);
      await tab.page.getByRole("button", { name: "Clear history", exact: true }).last().click();
      await tab.page.waitForTimeout(1500);
      const owner = await history(ctx);
      const mate = await history(ctx, "mate");
      await ctx.verify("the owner clears", [
        check("the owner's history is empty", owner.items.length === 0 && owner.total === 0, owner),
        check("the teammate keeps both runs", mate.items.length === 2 && mate.total === 2 && JSON.stringify(mate.items.map((item) => text(item, "source")).sort()) === JSON.stringify([`${TAGS_SOURCE}.slice(0, 1)`, `${TAGS_SOURCE}.slice(0, 2)`]), mate),
      ]);
      await runQuery(ctx, `${TAGS_SOURCE}.slice(0, 1)`, tableQuery("demo", "tags", [SLICE(1)]));
      const cleared = await db(ctx, "the teammate clears", "DELETE", "/query/history", { as: "mate" });
      await ctx.verify("the teammate clears", [
        check("the call succeeds", cleared.status === 200, cleared.status),
        check("the teammate's history is empty", (await history(ctx, "mate")).items.length === 0, "mate"),
        check("the owner's new run is untouched", (await history(ctx)).items.length === 1, "owner"),
      ]);
    },
  },
]);

/** History, saved queries and team queries. */
export const journeys = [...historyJourneys, ...savedJourneys];
