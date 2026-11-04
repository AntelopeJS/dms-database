import { guarded } from "../guard.mjs";
import { check, db, list, pick, runQuery, tableQuery, text } from "../database.mjs";
import { flat, openConsole, resultText, runSource } from "./parts/console.mjs";

/** @typedef {import("../database.mjs").Ctx} Ctx */
/** @typedef {import("../database.mjs").Tab} Tab */

const TAGS = 'schemas.demo.instance().table("tags")';
const RANT = `${TAGS}.filter((row) => row.key("name").eq("rant"))`;

/**
 * The names of the rows of demo.tags, read through the Data browser's API.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<string[]>} The sorted names
 */
async function tagNames(ctx) {
  const answer = await db(ctx, "tags", "GET", "/browse/list?filter_schema=demo&filter_table=tags&limit=200");
  return list(answer.body, "results").map((row) => text(row, "name")).sort();
}

/**
 * The text of the open confirmation, or an empty string when none is open.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The dialog text on one line
 */
async function dialogText(tab) {
  const dialogs = await tab.page.getByRole("dialog").allInnerTexts();
  return flat(dialogs.join(" | "));
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<number>} How many dialogs are open
 */
async function dialogs(tab) {
  return tab.page.getByRole("dialog").count();
}

/**
 * Cancels the open confirmation.
 *
 * @param {Tab} tab The tab
 */
async function cancel(tab) {
  await tab.page.getByRole("button", { name: "Cancel", exact: true }).click();
  await tab.page.waitForTimeout(500);
}

/** Writes are measured by a dry run and confirmed before they run. */
export const journeys = guarded([
  {
    id: "a-delete-names-its-operation-target-and-rows-and-waits-for-the-table-name",
    title: "a delete opens a confirmation naming the operation, the target and the rows the dry run found; the button does nothing until the exact table name is typed; Cancel and the dry run change nothing; Confirm deletes and the result says data changed",
    entryPoint: "/modules/database/query, POST /api/database/query/dry-run",
    async run(/** @type {Ctx} */ ctx) {
      const before = await tagNames(ctx);
      const tab = await openConsole(ctx);
      await runSource(tab, `${RANT}.delete()`);
      const opened = await dialogText(tab);
      await ctx.verify("the confirmation", [
        check("title, operation, target and rows", opened.startsWith("Delete 1 row from demo.tags?") && opened.includes("This query changes data. A dry run found what it will touch:") && /Operation delete Target demo\.tags Rows 1\b/.test(opened), opened),
        check("it asks for the table name", opened.includes("Type tags to confirm"), opened),
      ]);
      const box = tab.page.getByRole("textbox", { name: "Type tags to confirm" });
      for (const wrong of ["tag", "TAGS", "tags-", ""]) {
        await box.fill(wrong);
        await tab.page.getByRole("button", { name: "Delete 1 row" }).click({ timeout: 3000 }).catch(() => undefined);
        await tab.page.waitForTimeout(1200);
        await ctx.verify(`the name "${wrong}"`, [check("the confirmation stays open", (await dialogs(tab)) === 1, await dialogText(tab)), check("nothing was deleted", JSON.stringify(await tagNames(ctx)) === JSON.stringify(before), await tagNames(ctx))]);
      }
      await cancel(tab);
      await ctx.verify("Cancel", [check("no dialog and the data untouched", (await dialogs(tab)) === 0 && JSON.stringify(await tagNames(ctx)) === JSON.stringify(before), before)]);
      await runSource(tab, `${RANT}.delete()`);
      await tab.page.getByRole("textbox", { name: "Type tags to confirm" }).fill("tags");
      await tab.page.getByRole("button", { name: "Delete 1 row" }).click();
      await tab.page.waitForTimeout(2000);
      const result = await resultText(tab);
      await ctx.verify("Confirm", [
        check("the rant tag is gone, read through the API", JSON.stringify(await tagNames(ctx)) === JSON.stringify(before.filter((name) => name !== "rant")), await tagNames(ctx)),
        check("the result says it changed data and is not read-only", result.includes("1 changed") && !result.includes("read-only"), result.slice(0, 200)),
        check("the dialog closed", (await dialogs(tab)) === 0, await dialogText(tab)),
      ]);
    },
  },
  {
    id: "every-write-names-its-operation-and-counts-the-rows-it-would-touch",
    title: "delete, update and insert queries on three or two rows show Operation, Target and Rows from the dry run, a confirm button that says what will happen, and need the table name; a target on a named instance shows the instance; none writes before the confirmation",
    entryPoint: "/modules/database/query, POST /api/database/query/dry-run",
    async run(/** @type {Ctx} */ ctx) {
      const before = await tagNames(ctx);
      const tab = await openConsole(ctx);
      const cases = [
        [`${TAGS}.delete()`, "Delete 3 rows from demo.tags?", "delete", 3, "Delete 3 rows"],
        [`${TAGS}.update({name: "z"})`, "Update 3 rows in demo.tags?", "update", 3, "Update 3 rows"],
        [`${TAGS}.insert([{name: "a"}, {name: "b"}])`, "Insert 2 rows into demo.tags?", "insert", 2, "Insert 2 rows"],
      ];
      const checks = [];
      for (const [source, title, operation, rows, button] of cases) {
        await runSource(tab, String(source));
        const opened = await dialogText(tab);
        checks.push(
          check(`${operation}: ${title}`, opened.startsWith(String(title)), opened),
          check(`${operation}: Operation ${operation}, Target demo.tags, Rows ${rows}`, opened.includes(`Operation ${operation} Target demo.tags Rows ${rows}`), opened),
          check(`${operation}: the button reads ${button} and waits for the name`, opened.includes(`Cancel ${button}`) && opened.includes("Type tags to confirm"), opened),
        );
        await cancel(tab);
      }
      await runSource(tab, 'schemas.shop.instance("eu").table("orders").delete()');
      const eu = await dialogText(tab);
      checks.push(check("a named instance is part of the target and the 80 rows are counted", eu.startsWith("Delete 80 rows from shop.orders @eu?") && eu.includes("Target shop.orders @eu Rows 80"), eu));
      await cancel(tab);
      const orders = await db(ctx, "eu orders", "GET", "/browse/count?filter_schema=shop&filter_table=orders&filter_instance=is:eu");
      checks.push(check("nothing was written by any of them", JSON.stringify(await tagNames(ctx)) === JSON.stringify(before) && pick(orders.body, "total") === 80, [await tagNames(ctx), orders.body]));
      await ctx.verify("the confirmations", checks);
    },
  },
  {
    id: "confirming-a-single-row-update-needs-the-table-name-as-the-docs-say",
    title: "the docs and the FAQ say every write is confirmed by typing the table name; a single-row update must ask for it",
    entryPoint: "/modules/database/query, docs 'To confirm, type the table name'",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      await runSource(tab, `${RANT}.update({name: "typed"})`);
      const opened = await dialogText(tab);
      await ctx.verify("the confirmation", [check("it asks for the table name", opened.includes("Type tags to confirm"), opened)]);
    },
  },
  {
    id: "a-confirmed-write-acts-on-the-data-of-that-moment",
    title: "the dry run is a preview, not a locked snapshot: rows added after the dry run are changed by the confirmed write too",
    entryPoint: "/modules/database/query, POST /api/database/query/execute",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      await runSource(tab, `${TAGS}.delete()`);
      const opened = await dialogText(tab);
      await runQuery(ctx, `${TAGS}.insert([{name: "late"}])`, tableQuery("demo", "tags", [{ stage: "insert", args: [[{ name: "late" }]] }]));
      await tab.page.getByRole("textbox", { name: "Type tags to confirm" }).fill("tags");
      await tab.page.getByRole("button", { name: "Delete 3 rows" }).click();
      await tab.page.waitForTimeout(2000);
      const result = await resultText(tab);
      await ctx.verify("the write", [
        check("the dry run had counted three rows", opened.includes("Rows 3"), opened),
        check("all four rows are gone, including the one added after the dry run", (await tagNames(ctx)).length === 0, await tagNames(ctx)),
        check("the result counts four changed rows", result.includes("4 changed"), result.slice(0, 200)),
      ]);
    },
  },
  {
    id: "a-read-query-runs-straight-away",
    title: "read queries (a selection, a count) run at once with no confirmation and report read-only",
    entryPoint: "/modules/database/query",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openConsole(ctx);
      const selection = await runSource(tab, `${TAGS}.orderBy("name").slice(0, 10)`);
      const afterSelection = await dialogs(tab);
      await runSource(tab, `${TAGS}.count()`);
      await ctx.verify("reads", [check("a selection opens no dialog and shows its rows", afterSelection === 0 && /Result 3 rows \d+ ms · read-only/.test(selection), selection.slice(-200)), check("a count opens no dialog", (await dialogs(tab)) === 0, await dialogText(tab))]);
    },
  },
]);
