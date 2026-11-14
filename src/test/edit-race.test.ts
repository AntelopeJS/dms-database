import { strict as assert } from "node:assert";
import { Query, Schema } from "@antelopejs/interface-database";
import { createOwnerSession } from "./ownerSession";

const SCHEMA = "edit-race-regression";
const schema = new Schema<{ items: { _id: string; name: string } }>(SCHEMA, {
  items: { fields: { _id: "string", name: "string" }, indexes: {} },
});

describe("[integration] public PUT edit", () => {
  it("returns 404 when deletion wins between the validation read and update", async () => {
    const owner = await createOwnerSession("edit-race@example.test");
    const table = schema.instance("race").table("items");
    await table.insert({ _id: "victim", name: "before" }).run();
    const originalRun = Object.getOwnPropertyDescriptor(Query.prototype, "run");
    assert.ok(originalRun);
    let deleted = false;
    Query.prototype.run = async function () {
      if (
        !deleted &&
        this.stages.some(
          (stage) => stage.stage === "schema" && stage.options?.id === SCHEMA,
        ) &&
        this.stages.some((stage) => stage.stage === "update")
      ) {
        deleted = true;
        await table.get("victim").delete().run();
      }
      Object.defineProperty(this, "run", originalRun);
      const answer: unknown = await this.run();
      return answer;
    };
    try {
      const query = new URLSearchParams({
        filter_schema: `is:${SCHEMA}`,
        filter_instance: "is:race",
        filter_table: "is:items",
        id: "victim",
      });
      const response = await fetch(
        `http://127.0.0.1:5023/api/database/browse/edit?${query}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${owner.token}`,
            "Content-Type": "application/json",
            "x-antelopejs-namespace": "default",
          },
          body: JSON.stringify({ name: "after" }),
        },
      );
      const body = await response.text();
      assert.equal(deleted, true, body);
      assert.equal(await table.get("victim").run(), undefined);
      assert.equal(response.status, 404, body);
    } finally {
      Object.defineProperty(Query.prototype, "run", originalRun);
      await schema.destroyInstance("race").run();
      await owner.remove();
    }
  });
});
