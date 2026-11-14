import { strict as assert } from "node:assert";
import { User } from "@antelopejs/interface-dms/auth/db";
import { DatabaseConnectionsController } from "../routes/connections";
import { EXTERNAL_UNSUPPORTED } from "../service/connectionState";
import { refusal } from "./refusal";

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
          engine: null,
          access: "read-write",
          canWrite: true,
          unsupported: [],
        },
        {
          id: "erp",
          kind: "external",
          label: "erp",
          engine: "mongodb",
          access: "read",
          canWrite: true,
          unsupported,
        },
        {
          id: "archive",
          kind: "external",
          label: "archive",
          engine: "mongodb",
          access: "read",
          canWrite: false,
          unsupported,
        },
      ],
    });
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
      { status: 404, message: "Unknown connection: nope" },
    );
    assert.deepEqual(
      await refusal(controller.select(user("selecting-user"), {})),
      { status: 400, message: "Expected { connection: string }" },
    );
  });

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
});
