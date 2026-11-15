import { strict as assert } from "node:assert";
import { setTimeout as delay } from "node:timers/promises";
import { Schema } from "@antelopejs/interface-database";
import { tableWatchTrigger } from "../automation/tableWatch";

type Emitted = Parameters<Parameters<typeof tableWatchTrigger.activate>[1]>[0];

const SCHEMA = "table-watch-feed";
const schema = new Schema<{ rows: { _id: string; name: string } }>(SCHEMA, {
  rows: { fields: { _id: "string", name: "string" }, indexes: {} },
});

async function until(events: Emitted[], count: number): Promise<void> {
  for (let waited = 0; events.length < count && waited < 10_000; waited += 50) {
    await delay(50);
  }
}

describe("[integration] the table watch", function () {
  this.timeout(30_000);

  it("hands its run the insert, update and delete of a row", async () => {
    const events: Emitted[] = [];
    const handle = await tableWatchTrigger.activate(
      { schema: SCHEMA, table: "rows" },
      (event) => events.push(event),
    );
    try {
      const table = schema.instance().table("rows");
      await table.insert({ _id: "r1", name: "first" }).run();
      await table.get("r1").update({ name: "second" }).run();
      await table.get("r1").delete().run();
      await until(events, 3);
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
    }
  });
});
