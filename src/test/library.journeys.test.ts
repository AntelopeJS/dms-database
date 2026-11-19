import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import { SCHEMA_NAME } from "../types/constants";
import { call } from "./helpers/http";
import { at, itemsAt, textAt } from "./helpers/pick";
import { withOwnDatabase } from "./ownDatabase";
import { createOwnerSession, type OwnerSession } from "./ownerSession";
import { encode } from "./stagedWire";

const SCHEMA = "library-journeys-tags";
const schema = new Schema<{ tags: { _id: string; name: string } }>(SCHEMA, {
  tags: { fields: { _id: "string", name: "string" }, indexes: {} },
});
const QUERY = encode(schema.instance().table("tags"));
const SOURCE = `schemas["${SCHEMA}"].instance().table("tags")`;

/** What the library journey reads of a stored history or saved-query row. */
interface StoredRow {
  source: string;
  name?: string;
  shared?: boolean;
}

/** The rows of one of the module's own tables, read by a client of its own, as a restarted backend would read them. */
function storedRows(table: string, filter: Partial<StoredRow>) {
  return withOwnDatabase((db) =>
    db.collection<StoredRow>(`${SCHEMA_NAME}__${table}`).find(filter).toArray(),
  );
}

describe("[integration] library journeys", () => {
  let owner: OwnerSession;
  let savedId = "";

  before(async () => {
    owner = await createOwnerSession("library-journeys-owner@test.local");
    await schema
      .instance()
      .table("tags")
      .insert([{ _id: "t1", name: "intro" }])
      .run();
  });
  after(async () => {
    await call(owner, "DELETE", "/database/query/history");
    if (savedId)
      await call(owner, "DELETE", `/database/query/saved/${savedId}`);
    await owner.remove();
    await schema.instance().table("tags").delete().run();
  });

  it("the-library-survives-a-backend-restart", async () => {
    const run = await call(owner, "POST", "/database/query/execute", {
      query: QUERY,
      source: SOURCE,
      language: "aql",
    });
    assert.equal(run.status, 200, run.text);
    const saved = await call(owner, "POST", "/database/query/saved", {
      name: "Durable",
      description: "about Durable",
      query: QUERY,
      source: SOURCE,
      language: "aql",
      shared: true,
    });
    savedId = textAt(saved.body, "id");
    assert.notEqual(savedId, "", saved.text);

    const history = await storedRows("query_history", { source: SOURCE });
    const library = await storedRows("saved_queries", { source: SOURCE });
    assert.deepEqual(
      history.map((row) => row.source),
      [SOURCE],
      "a history kept in the backend's memory would leave no row in the module's own table",
    );
    assert.deepEqual(
      library.map((row) => [row.name, row.shared]),
      [["Durable", true]],
      "a saved query kept in the backend's memory would leave no row in the module's own table",
    );

    const runs = itemsAt(
      (await call(owner, "GET", "/database/query/history?limit=500")).body,
      "items",
    );
    assert.deepEqual(
      runs.map((item) => textAt(item, "source")),
      [SOURCE],
      "the run is kept",
    );
    const listed = itemsAt(
      (await call(owner, "GET", "/database/query/saved")).body,
      "items",
    );
    assert.deepEqual(
      listed.map((item) => [at(item, "name"), at(item, "shared")]),
      [["Durable", true]],
      "the saved query is kept, still shared",
    );
  });
});
