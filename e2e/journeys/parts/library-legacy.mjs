import { randomUUID } from "node:crypto";
import { check, runQuery, tableQuery, text, pick } from "../../database.mjs";
import { flat, openConsole } from "./console.mjs";
import { SLICE, TAGS_SOURCE, history } from "./library-kit.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("mongodb").Db} Db */
/** @typedef {import("mongodb").Collection} Collection */

const DAY_MS = 24 * 60 * 60 * 1000;
const OLDER_DAYS = 3;
const HISTORY_COLLECTION = /query_history$/;
const LEGACY_SOURCE = `${TAGS_SOURCE}.slice(0, 1)`;
const NEWER_SOURCE = `${TAGS_SOURCE}.slice(0, 2)`;
const OLDER_SOURCE = `${TAGS_SOURCE}.slice(0, 3)`;

/**
 * The module's history collection: the one collection of the journey's database named like the `query_history` table.
 *
 * @param {Db} database The database the backend reads
 * @returns {Promise<Collection>} Its history collection
 */
async function historyCollection(database) {
  const names = (await database.listCollections().toArray()).map((collection) => collection.name);
  const found = names.filter((name) => HISTORY_COLLECTION.test(name));
  const [name] = found;
  if (name === undefined || found.length !== 1) throw new Error(`expected one query_history collection among ${JSON.stringify(names)}`);
  return database.collection(name);
}

/**
 * Moves the stored date of the runs with `source` back by `days` days.
 *
 * @param {Ctx} ctx The journey
 * @param {string} source The AQL text of the runs to age
 * @param {number} days How many days back
 * @returns {Promise<number>} How many rows were aged
 */
function age(ctx, source, days) {
  return ctx.database(`age ${source} by ${days} days`, async (database) => {
    const runs = await historyCollection(database);
    const moved = await runs.updateMany({ source }, { $set: { executedAt: new Date(Date.now() - days * DAY_MS) } });
    return moved.modifiedCount;
  });
}

/**
 * The text of the console's library, with the history's day headings and its rows in order.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<string>} The flattened page text up to the history's closing sentence
 */
async function libraryText(ctx) {
  const tab = await openConsole(ctx);
  await tab.page.waitForTimeout(800);
  return (flat(await tab.page.locator("body").innerText()).split("Your last 500")[0] ?? "");
}

/** What the history does with rows the clock or an older release left behind. */
export const legacyJourneys = [
  {
    id: "history-groups-runs-by-day-with-yesterday-and-older-dates",
    title: "a run moved back one day lists under Yesterday and one moved back three days under its date, below today's runs under Today; the API still lists all three newest first",
    entryPoint: "/modules/database/query History tab, GET /api/database/query/history",
    async run(/** @type {Ctx} */ ctx) {
      await runQuery(ctx, OLDER_SOURCE, tableQuery("demo", "tags", [SLICE(3)]));
      await runQuery(ctx, LEGACY_SOURCE, tableQuery("demo", "tags", [SLICE(1)]));
      await runQuery(ctx, NEWER_SOURCE, tableQuery("demo", "tags", [SLICE(2)]));
      const aged = [await age(ctx, LEGACY_SOURCE, 1), await age(ctx, OLDER_SOURCE, OLDER_DAYS)];
      const olderLabel = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(new Date(Date.now() - OLDER_DAYS * DAY_MS));
      const listed = await history(ctx);
      const sources = listed.items.map((item) => text(item, "source"));
      await ctx.verify("the stored dates", [
        check("one row of each aged source moved", aged[0] === 1 && aged[1] === 1, aged),
        check("the API lists the three runs newest first", JSON.stringify(sources) === JSON.stringify([NEWER_SOURCE, LEGACY_SOURCE, OLDER_SOURCE]), sources),
      ]);
      const body = await libraryText(ctx);
      const lower = body.toLowerCase();
      const today = lower.indexOf("today");
      const yesterday = lower.indexOf("yesterday");
      const older = lower.indexOf(olderLabel.toLowerCase(), yesterday);
      const newer = body.indexOf(NEWER_SOURCE);
      const legacy = body.indexOf(LEGACY_SOURCE);
      const oldest = body.indexOf(OLDER_SOURCE);
      await ctx.verify("the library", [
        check("the headings run Today, Yesterday, then the older day's date", today >= 0 && yesterday > today && older > yesterday, { today, yesterday, older, olderLabel, body: body.slice(0, 800) }),
        check("today's run is under Today", newer > today && newer < yesterday, { newer, today, yesterday }),
        check("yesterday's run is under Yesterday", legacy > yesterday && legacy < older, { legacy, yesterday, older }),
        check("the three-day-old run is under its date", oldest > older, { oldest, older }),
        check("each heading appears once", lower.split("yesterday").length === 2 && lower.split("today").length === 2, body.slice(0, 800)),
      ]);
    },
  },
  {
    id: "a-history-row-without-a-status-reads-as-ok",
    title: "a row stored before runs recorded a status, a mutation flag or an error is listed as a successful run: the API says status ok and no mutation, the library shows its duration and rows, never a failure",
    entryPoint: "GET /api/database/query/history, /modules/database/query History tab",
    async run(/** @type {Ctx} */ ctx) {
      await runQuery(ctx, NEWER_SOURCE, tableQuery("demo", "tags", [SLICE(2)]));
      const written = (await history(ctx)).items[0];
      const stored = await ctx.database("write a row as an older release stored it", async (database) => {
        const runs = await historyCollection(database);
        const row = {
          _id: randomUUID(),
          userId: text(written, "userId"),
          query: pick(written, "query"),
          source: LEGACY_SOURCE,
          language: text(written, "language"),
          durationMs: 7,
          rowCount: 1,
          executedAt: new Date(Date.now() - 1000),
        };
        await runs.insertOne(row);
        return Object.keys((await runs.findOne({ _id: row._id })) ?? {}).sort();
      });
      await ctx.verify("the stored row", [
        check("the legacy row has no status, mutation or error field", !["status", "mutation", "error"].some((field) => stored.includes(field)), stored),
        check("a run the module wrote carries a status", pick(written, "status") === "ok", written),
      ]);
      const listed = await history(ctx);
      const legacy = listed.items.find((item) => text(item, "source") === LEGACY_SOURCE);
      await ctx.verify("the API", [
        check("the legacy row is listed and counted", legacy !== undefined && listed.total === 2, [listed.total, listed.items.length]),
        check("it reads as ok, not a mutation, with its rows and no error", pick(legacy, "status") === "ok" && pick(legacy, "mutation") === false && pick(legacy, "rowCount") === 1 && pick(legacy, "error") === undefined, legacy),
      ]);
      const body = await libraryText(ctx);
      await ctx.verify("the library", [
        check("the legacy run shows its duration and row, as a successful run does", /demo\.tags schemas\.demo\.instance\(\)\.table\("tags"\)\.slice\(0, 1\) \d\d:\d\d [AP]M · 7 ms · 1 row\b/.test(body), body.slice(0, 900)),
        check("nothing is worded as a failure", !/Unknown|failed|error/i.test(body), body.slice(0, 900)),
      ]);
    },
  },
];
