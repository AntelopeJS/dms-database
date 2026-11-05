import { guarded } from "../../guard.mjs";
import { check, db, list, member, pick, runQuery, tableQuery, text } from "../../database.mjs";
import { editorText, flat, openConsole, runSource } from "./console.mjs";
import { SLICE, TAGS_QUERY, TAGS_SOURCE, history, libraryTab, save } from "./library-kit.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */
/** Saved and team queries, and the library after a restart. */
export const savedJourneys = guarded([
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
