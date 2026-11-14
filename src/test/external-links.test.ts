import { strict as assert } from "node:assert";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { ConnectionSelectionModel } from "../db/models/connection_selections.model";
import { lockedOnExternal } from "../pages/externalLock";

const EXTERNAL_USER = Object.assign(new User(), {
  _id: "external-links-external-user",
});
const OWN_USER = Object.assign(new User(), { _id: "external-links-own-user" });

const [link, locked] = lockedOnExternal({
  id: "open-query",
  label: "Open query console",
  icon: "i-ph-code",
  target: { type: "page", url: "/modules/database/query" },
});

function served(user: User) {
  return Promise.all(
    [link, locked].map(async (button) =>
      button.availability?.({ tenantId: "default", user }),
    ),
  );
}

describe("[integration] a header link to a page an external database cannot serve", () => {
  before(async () => {
    await GetModel(ConnectionSelectionModel).select(EXTERNAL_USER._id, "erp");
  });

  it("serves the link and hides its locked twin on the own database", async () => {
    assert.deepEqual(await served(OWN_USER), [undefined, { hidden: true }]);
  });

  it("serves the locked twin, with the lock icon and the reason, on an external database", async () => {
    assert.deepEqual(await served(EXTERNAL_USER), [
      { hidden: true },
      { reason: "$dms_database.connections.locked.reason" },
    ]);
    assert.equal(locked.icon, "i-ph-lock");
    assert.equal(locked.id, "open-query-locked");
    assert.deepEqual(locked.target, link.target);
  });
});
