import { strict as assert } from "node:assert";
import {
  ACTIONS,
  DATA_NODES,
  registerAutomationNodes,
  TRIGGERS,
  unregisterAutomationNodes,
} from "../automation";

describe("the database automation nodes", () => {
  it("declare the two triggers, four actions and two data nodes of the module", () => {
    assert.deepEqual(
      TRIGGERS.map(({ id }) => id),
      ["database.table-watch", "database.connection-status"],
    );
    assert.deepEqual(
      ACTIONS.map(({ id }) => id),
      [
        "database.get-row",
        "database.count-rows",
        "database.run-saved-query",
        "database.health",
      ],
    );
    assert.deepEqual(
      DATA_NODES.map(({ id, category }) => ({ id, category })),
      [
        { id: "database.row-diff", category: "database" },
        { id: "database.field-changed", category: "database" },
      ],
    );
  });

  it("mark the reads free of side effects, and give the saved query a dry run instead", () => {
    const byId = new Map(ACTIONS.map((action) => [action.id, action]));
    for (const id of [
      "database.get-row",
      "database.count-rows",
      "database.health",
    ]) {
      assert.equal(byId.get(id)?.sideEffects, false, id);
    }
    const saved = byId.get("database.run-saved-query");
    assert.equal(saved?.sideEffects, undefined);
    assert.ok(saved && "dryRun" in saved && saved.dryRun !== undefined);
  });

  it("withdraw and declare again without an error, as a reload does", async () => {
    await assert.doesNotReject(async () => {
      await unregisterAutomationNodes();
      await unregisterAutomationNodes();
      await registerAutomationNodes();
      await registerAutomationNodes();
    });
  });
});
