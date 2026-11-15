import { strict as assert } from "node:assert";
import { setTimeout as delay } from "node:timers/promises";
import { Schema } from "@antelopejs/interface-database";
import { tableWatchTrigger } from "../automation/tableWatch";
import { withOwnDatabase } from "./ownDatabase";

type Emitted = Parameters<Parameters<typeof tableWatchTrigger.activate>[1]>[0];

const SCHEMA = "table-watch-feed";
const schema = new Schema<{ rows: { _id: string; name: string } }>(SCHEMA, {
  rows: { fields: { _id: "string", name: "string" }, indexes: {} },
});

const UNRECORDED = "table-watch-unrecorded";
const unrecorded = new Schema<{ rows: { _id: string } }>(UNRECORDED, {
  rows: { fields: { _id: "string" }, indexes: {} },
});

async function until(events: Emitted[], count: number): Promise<void> {
  for (let waited = 0; events.length < count && waited < 10_000; waited += 50) {
    await delay(50);
  }
}

describe("[integration] the table watch", function () {
  this.timeout(30_000);

  it("hands its run the insert, update and delete of a row of the default instance, and nothing of another instance", async () => {
    const events: Emitted[] = [];
    const handle = await tableWatchTrigger.activate(
      { schema: SCHEMA, table: "rows" },
      (event) => events.push(event),
    );
    try {
      const other = schema.instance("other").table("rows");
      await other.insert({ _id: "o1", name: "elsewhere" }).run();
      await other.get("o1").delete().run();
      const table = schema.instance().table("rows");
      await table.insert({ _id: "r1", name: "first" }).run();
      await table.get("r1").update({ name: "second" }).run();
      await table.get("r1").delete().run();
      await until(events, 3);
      await delay(500);
      assert.deepEqual(
        events.map(({ type, old, new: row }) => ({ type, old, new: row })),
        [
          { type: "insert", old: null, new: { _id: "r1", name: "first" } },
          {
            type: "update",
            old: { _id: "r1", name: "first" },
            new: { _id: "r1", name: "second" },
          },
          { type: "delete", old: { _id: "r1", name: "second" }, new: null },
        ],
      );
    } finally {
      await tableWatchTrigger.deactivate(handle);
      await schema.destroyInstance("other").run();
    }
  });

  it("fails its activation with the store's refusal on a collection that records no pre-images", async () => {
    await unrecorded.instance().table("rows").insert({ _id: "seed" }).run();
    const collection = `${UNRECORDED}__rows`;
    await withOwnDatabase((db) =>
      db.command({
        collMod: collection,
        changeStreamPreAndPostImages: { enabled: false },
      }),
    );
    await assert.rejects(
      tableWatchTrigger.activate(
        { schema: UNRECORDED, table: "rows" },
        () => undefined,
      ),
      {
        message: `table-watch: cannot open change feed on ${UNRECORDED}.rows: changes() of one instance needs change stream pre-images, which collection ${collection} does not record, so the feed would miss its updates and deletes: enable them with db.runCommand({ collMod: "${collection}", changeStreamPreAndPostImages: { enabled: true } })`,
      },
    );
  });
});
