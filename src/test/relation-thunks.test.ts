import { strict as assert } from "node:assert";
import listener, {
  type Log,
} from "@antelopejs/interface-core/logging/listener";
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

  @Relation({
    to: () => {
      throw { message: 42 };
    },
  })
  declare numbered: string;

  @Relation({
    to: () => {
      throw {};
    },
  })
  declare bare: string;

  @Relation({
    to: () => {
      throw new Error("boom-error");
    },
  })
  declare error: string;
}

/** Keeps the decorated class referenced: the decorator registers it. */
const TABLES = [Throwers];

/** The text of the warning logged for a relation field of the shop schema. */
function warningFor(logs: string[], field: string): string | undefined {
  const marker = `${SCHEMA}::throwers::${field} target thunk threw: `;
  return logs.find((line) => line.includes(marker))?.split(marker)[1];
}

describe("a relation whose target thunk throws", () => {
  it("is skipped whatever it threw, and the schema listing still answers", async () => {
    assert.equal(TABLES.length, 1);
    const logs: string[] = [];
    const record = (log: Log) => {
      logs.push(log.args.map(String).join(" "));
    };
    listener.register(record);
    try {
      await RegisterSchema(SCHEMA);
      const summary = (await listSchemaSummaries()).find(
        (s) => s.id === SCHEMA,
      );
      const table = summary?.tables.find((t) => t.name === "throwers");
      assert.ok(table, "the table is listed");
      assert.deepEqual(table.relations, []);
    } finally {
      listener.unregister(record);
    }
    assert.equal(warningFor(logs, "text"), "boom-string");
    assert.equal(warningFor(logs, "nothing"), "null");
    assert.equal(warningFor(logs, "record"), "plain-object");
    assert.equal(warningFor(logs, "numbered"), "42");
    assert.equal(warningFor(logs, "bare"), "an object without a message");
    assert.equal(warningFor(logs, "error"), "boom-error");
  });
});
