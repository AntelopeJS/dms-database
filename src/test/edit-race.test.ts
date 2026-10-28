import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { Query, Schema } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { SessionModel, UserModel } from "@antelopejs/interface-dms/auth/db";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import type { JsonValue } from "../types/json";

const SCHEMA = "edit-race-regression";
const schema = new Schema<{ items: { _id: string; name: string } }>(SCHEMA, {
  items: { fields: { _id: "string", name: "string" }, indexes: {} },
});

describe("[integration] public PUT edit", () => {
  it("returns 404 when deletion wins between the validation read and update", async () => {
    const users = GetModel(UserModel);
    const sessions = GetModel(SessionModel);
    const now = new Date();
    const [userId] = await users.insert({
      email: "edit-race@example.test",
      name: "Edit race",
      authKey: "edit-race-key",
      isValidated: true,
      owner: true,
      language: "en",
      createdAt: now,
      updatedAt: now,
    });
    const [sessionId] = await sessions.insert({
      userId,
      userAgent: "",
      ip: "",
      browser: "Unknown",
      os: "Unknown",
      deviceType: "desktop",
      location: "",
      createdAt: now,
      lastActiveAt: now,
    });
    const encode = (value: JsonValue) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
      id: userId,
      tenantId: DEFAULT_TENANT_ID,
      sessionId,
      purpose: "access",
      exp: Math.floor(Date.now() / 1000) + 300,
    })}`;
    const token = `${unsigned}.${createHmac("sha256", "1:edit-race-key:test-jwt-secret").update(unsigned).digest("base64url")}`;
    const table = schema.instance("race").table("items");
    await table.insert({ _id: "victim", name: "before" }).run();
    // oxlint-disable-next-line typescript/unbound-method -- saved unbound deliberately: restored below and invoked with the query receiver
    const originalRun = Query.prototype.run;
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
      return originalRun.call(this);
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
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "x-antelopejs-namespace": "default",
          },
          body: JSON.stringify({ name: "after" }),
        },
      );
      const body = await response.text();
      assert.equal(deleted, true, body);
      assert.equal(await table.get("victim"), undefined);
      assert.equal(response.status, 404, body);
    } finally {
      Query.prototype.run = originalRun;
      await schema.destroyInstance("race").run();
      await sessions.delete(sessionId);
      await users.delete(userId);
    }
  });
});
