import { strict as assert } from "node:assert";
import { User } from "@antelopejs/interface-dms/auth/db";
import { DatabaseConnectionsController } from "../routes/connections";
import { EXTERNAL_UNSUPPORTED } from "../service/connectionState";
import { REFUSALS } from "../service/refusals";
import { refusal, refused } from "./refusal";

const controller = new DatabaseConnectionsController();
const unsupported = [...EXTERNAL_UNSUPPORTED];

function user(id: string): User {
  return Object.assign(new User(), { _id: id });
}

describe("[integration] external connections: listing and selection", () => {
  it("lists the own database, then each external one with the access the project gives it and what its account can do", async () => {
    assert.deepEqual(await controller.list(user("listing-user")), {
      selected: "own",
      accessEditable: false,
      connections: [
        {
          id: "own",
          kind: "own",
          label: "own",
          database: null,
          engine: null,
          access: "read-write",
          canWrite: true,
          unsupported: [],
          missing: [],
        },
        {
          id: "erp",
          kind: "external",
          label: "erp",
          database: "erp",
          engine: "mongodb",
          access: "read",
          canWrite: true,
          unsupported,
          missing: [],
        },
        {
          id: "archive",
          kind: "external",
          label: "archive",
          database: "archive",
          engine: "mongodb",
          access: "read",
          canWrite: false,
          unsupported,
          missing: [],
        },
        ...["shop", "ledger", "legacy", "blank"].map((id) => ({
          id,
          kind: "external",
          label: id,
          database: id === "shop" ? "erp" : null,
          engine: id === "shop" ? "mongodb" : null,
          access: id === "ledger" ? "read-write" : "read",
          canWrite: id === "shop" ? true : null,
          unsupported,
          missing: id === "shop" ? ["database"] : ["database", "catalog"],
        })),
      ],
    });
  });

  it("refuses to select a connection that is declared but not registered, which an implementation that selects any listed id gets wrong", async () => {
    assert.deepEqual(
      await refusal(
        controller.select(user("half-user"), { connection: "shop" }),
      ),
      refused(REFUSALS.unknownConnection),
    );
    assert.equal((await controller.list(user("half-user"))).selected, "own");
  });

  it("keeps each user's selection apart, and refuses a connection that does not exist", async () => {
    const picked = await controller.select(user("selecting-user"), {
      connection: "erp",
    });
    assert.equal(picked.selected, "erp");
    assert.equal(
      (await controller.list(user("selecting-user"))).selected,
      "erp",
    );
    assert.equal((await controller.list(user("other-user"))).selected, "own");
    assert.deepEqual(
      await refusal(
        controller.select(user("selecting-user"), { connection: "nope" }),
      ),
      refused(REFUSALS.unknownConnection),
    );
    assert.deepEqual(
      await refusal(controller.select(user("selecting-user"), {})),
      refused(REFUSALS.selectionBody),
    );
  });
});

describe("[integration] external connections: relations", () => {
  it("describes an external relation from the connection's catalog", async () => {
    const reader = user("relations-user");
    const { items } = await controller.relations(reader, "erp");
    assert.deepEqual(
      items.map(({ schema, name, key }) => ({ schema, name, key })),
      [
        {
          schema: "erp",
          name: "customers",
          key: { columns: ["_id"], source: "primary" },
        },
      ],
    );
    const description = await controller.relation(
      reader,
      "erp",
      "erp.customers",
    );
    assert.deepEqual(description.columns.map(({ name }) => name).sort(), [
      "_id",
      "name",
      "segment",
    ]);
    assert.equal(
      (await refusal(controller.relation(reader, "erp", "erp.missing"))).status,
      404,
    );
  });

  it("refuses the relations of a connection the project does not have with the sentence the dashboard translates", async () => {
    const reader = user("relations-user");
    assert.deepEqual(
      await refusal(controller.relations(reader, "nope")),
      refused(REFUSALS.unknownConnection),
    );
    assert.deepEqual(
      await refusal(controller.relation(reader, "nope", "erp.customers")),
      refused(REFUSALS.unknownConnection),
    );
  });
});
