import { strict as assert } from "node:assert";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { ConnectionSelectionModel } from "../db/models/connection_selections.model";
import { linksHiddenOnExternal, lockedOnExternal } from "../pages/externalLock";
import { DatabaseTablesController } from "../routes/tables";

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

describe("[integration] a link in a page's body to a page an external database cannot serve", () => {
  before(async () => {
    await GetModel(ConnectionSelectionModel).select(EXTERNAL_USER._id, "erp");
  });

  const FEED = {
    title: "Recent queries",
    actions: [{ label: "Open console", to: "/modules/database/query" }],
  };

  function feedFor(user: User) {
    return linksHiddenOnExternal(new Set(), FEED, "feed", {
      tenantId: "default",
      user,
    });
  }

  async function sourceFor(user: User) {
    const { results } = await new DatabaseTablesController().source(
      user,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    return results;
  }

  it("keeps the recent queries' console link on the own database", async () => {
    assert.deepEqual(await feedFor(OWN_USER), FEED);
  });

  it("leaves out the recent queries' console link on an external database", async () => {
    assert.deepEqual(await feedFor(EXTERNAL_USER), {
      ...FEED,
      actions: undefined,
    });
  });

  it("marks the Schemas rows of an external database, which hide Query and Diagram", async () => {
    const external = await sourceFor(EXTERNAL_USER);
    const own = await sourceFor(OWN_USER);
    assert.ok(external.length > 0, "the external database lists tables");
    assert.ok(own.length > 0, "the own database lists tables");
    assert.ok(external.every((row) => row.external));
    assert.ok(own.every((row) => !row.external));
  });
});
