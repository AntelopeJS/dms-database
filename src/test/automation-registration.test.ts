import { strict as assert } from "node:assert";
import {
  ACTIONS,
  AutomationNodeRegistration,
  DATA_NODES,
  type NodeRegistry,
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

  it("are each declared on the registry, and none is left after the withdrawal", () => {
    const { registry, ids } = recordingRegistry();
    const registration = new AutomationNodeRegistration();
    assert.deepEqual(ids(), []);
    registration.register(registry);
    registration.register(registry);
    assert.deepEqual(ids(), ALL_IDS);
    registration.unregister(registry);
    assert.deepEqual(ids(), []);
  });

  it("withdraw what was declared when one declaration fails", () => {
    const { registry, ids } = recordingRegistry();
    const failing: NodeRegistry = {
      ...registry,
      RegisterDataNodeType: () => {
        throw new Error("refused");
      },
    };
    assert.throws(() => new AutomationNodeRegistration().register(failing), {
      message: "refused",
    });
    assert.deepEqual(ids(), []);
  });
});

const ALL_IDS = [
  "action:database.count-rows",
  "action:database.get-row",
  "action:database.health",
  "action:database.run-saved-query",
  "data:database.field-changed",
  "data:database.row-diff",
  "trigger:database.connection-status",
  "trigger:database.table-watch",
];

function recordingRegistry() {
  const live = new Set<string>();
  const registry: NodeRegistry = {
    RegisterTriggerType: ({ id }) => void live.add(`trigger:${id}`),
    UnregisterTriggerType: (id) => void live.delete(`trigger:${id}`),
    RegisterActionType: ({ id }) => void live.add(`action:${id}`),
    UnregisterActionType: (id) => void live.delete(`action:${id}`),
    RegisterDataNodeType: ({ id }) => void live.add(`data:${id}`),
    UnregisterDataNodeType: (id) => void live.delete(`data:${id}`),
  };
  return { registry, ids: () => [...live].sort() };
}
