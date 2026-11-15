import { setTimeout as delay } from "node:timers/promises";
import { check, db, isRow, list, parseJson, pick, show, text, withConfig } from "../../database.mjs";
import { queryDelete, queryInsert } from "./query-wire.mjs";

/**
 * @typedef {import("../../database.mjs").Ctx} Ctx
 * @typedef {import("../../database.mjs").Answer} Answer
 */

const AUTOMATION = "/api/automation";
const ROW = { _id: "watch-1", name: "Watched lamp", price: 12, tags: ["office"] };
const OTHER_INSTANCE_ROW = { _id: "watch-eu", name: "Lamp of eu", price: 9, tags: [] };

/**
 * Calls the automation module's API as the platform owner.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} method The HTTP method
 * @param {string} path The path under `/api/automation`
 * @param {unknown} [body] The JSON body
 * @returns {Promise<Answer>} The answer
 */
function automation(ctx, label, method, path, body) {
  return ctx.api(label, { method, path: `${AUTOMATION}${path}`, body });
}

/** A procedure whose only node is a table watch on the default instance of shop.products. */
const PROCEDURE = {
  name: "Watch products",
  description: "",
  graph: {
    nodes: [{ id: "watch", kind: "trigger", typeId: "database.table-watch", config: { schema: "shop", table: "products" }, position: { x: 0, y: 0 } }],
    triggerEdges: [],
    dataEdges: [],
  },
};

/**
 * Reads the runs of a procedure until `count` are listed or 20 s pass, then 2 s more so a late extra run shows.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure id
 * @param {number} count The runs expected
 * @returns {Promise<unknown[]>} The runs, oldest first
 */
async function runsOf(ctx, id, count) {
  const read = async () => list((await automation(ctx, "the procedure's runs", "GET", `/procedures/${id}/runs`)).body).toReversed();
  for (let waited = 0; waited < 20_000; waited += 1_000) {
    if ((await read()).length >= count) break;
    await delay(1_000);
  }
  await delay(2_000);
  return read();
}

/**
 * @param {unknown} run A run of the runs list
 * @param {Ctx} ctx The journey
 * @returns {Promise<{ type: string, old: unknown, new: unknown }>} What the trigger handed the run
 */
async function payloadOf(run, ctx) {
  const detail = await automation(ctx, "a run", "GET", `/runs/${text(run, "_id")}`);
  const payload = parseJson(text(detail.body, "triggerPayload"));
  return { type: text(payload, "type"), old: pick(payload, "old"), new: pick(payload, "new") };
}

/** The table watch trigger seen through a procedure of the automation module. */
export const tableWatchJourney = {
  id: "the-table-watch-hands-a-procedure-each-insert-update-and-delete",
  title: "with @antelopejs/dms-automation loaded, an enabled procedure on a Table watch of shop.products runs once on an insert, an update and a delete of a row of the default instance, each run carrying the rows, and not on a row of the eu instance",
  entryPoint: "POST /api/automation/procedures/import, PUT /procedures/:id/enabled, POST /api/database/query/execute, PUT /api/database/browse/edit, GET /procedures/:id/runs, /runs/:id",
  backend: "dev",
  async run(/** @type {Ctx} */ ctx) {
    await withConfig(ctx, { VERIFY_DATABASE_AUTOMATION: "1" }, async () => {
      const created = await automation(ctx, "import the procedure", "POST", "/procedures/import", { json: JSON.stringify(PROCEDURE) });
      const id = text(created.body, "_id");
      const enabled = await automation(ctx, "enable it", "PUT", `/procedures/${id}/enabled`, { enabled: true });
      await ctx.verify("the procedure is armed", [check("the import answers an id", id !== "", show(created.body)), check("enabling answers 200", enabled.status === 200, show(enabled.body))], { critical: true });
      await delay(3_000);
      await queryInsert(ctx, "shop", "products", [OTHER_INSTANCE_ROW], "eu");
      await queryDelete(ctx, "shop", "products", OTHER_INSTANCE_ROW._id, "eu");
      const inserted = await queryInsert(ctx, "shop", "products", [ROW]);
      const edited = await db(ctx, "rename the row in the data browser", "PUT", `/browse/edit?filter_schema=is:shop&filter_table=is:products&id=${ROW._id}&connection=own`, { body: { name: "Renamed lamp" } });
      const deleted = await queryDelete(ctx, "shop", "products", ROW._id);
      await ctx.verify("the writes", [check("the insert answers 200", inserted.status === 200, show(inserted.body)), check("the edit answers 200", edited.status === 200, show(edited.body)), check("the delete answers 200", deleted.status === 200, show(deleted.body))]);
      const payloads = await Promise.all((await runsOf(ctx, id, 3)).map((run) => payloadOf(run, ctx)));
      const renamed = { ...ROW, name: "Renamed lamp" };
      await ctx.verify("one run per write of the default instance", [
        check("three runs, insert then update then delete", JSON.stringify(payloads.map((payload) => payload.type)) === JSON.stringify(["insert", "update", "delete"]), show(payloads)),
        check("the insert carries the new row and no old one", JSON.stringify(payloads[0]) === JSON.stringify({ type: "insert", old: null, new: ROW }), show(payloads[0])),
        check("the update carries the row before and after", JSON.stringify(payloads[1]) === JSON.stringify({ type: "update", old: ROW, new: renamed }), show(payloads[1])),
        check("the delete carries the row it removed", JSON.stringify(payloads[2]) === JSON.stringify({ type: "delete", old: renamed, new: null }), show(payloads[2])),
        check("no run carries the eu row", !payloads.some((payload) => [payload.old, payload.new].some((row) => isRow(row) && row._id === OTHER_INSTANCE_ROW._id)), show(payloads)),
      ]);
    });
  },
};
