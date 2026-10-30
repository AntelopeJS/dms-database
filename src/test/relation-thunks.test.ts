import { strict as assert } from "node:assert";
import {
  Relation,
  RegisterSchema,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { listSchemaSummaries } from "../service/introspect";

const SCHEMA = "relation-thunks-shop";

@RegisterTable("throwers", SCHEMA)
class Throwers extends Table {
  declare _id: string;

  @Relation({
    to: () => {
      throw "boom-string";
    },
  })
  declare text: string;

  @Relation({
    to: () => {
      throw null;
    },
  })
  declare nothing: string;

  @Relation({
    to: () => {
      throw { message: "plain-object" };
    },
  })
  declare record: string;
}

/** Keeps the decorated class referenced: the decorator registers it. */
const TABLES = [Throwers];

describe("a relation whose target thunk throws", () => {
  it("is skipped whatever it threw, and the schema listing still answers", async () => {
    assert.equal(TABLES.length, 1);
    await RegisterSchema(SCHEMA);
    const summary = (await listSchemaSummaries()).find((s) => s.id === SCHEMA);
    const table = summary?.tables.find((t) => t.name === "throwers");
    assert.ok(table, "the table is listed");
    assert.deepEqual(table.relations, []);
  });
});
