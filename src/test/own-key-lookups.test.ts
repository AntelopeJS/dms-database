import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import {
  RegisterSchema,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { buildEditUpdates } from "../service/rowEdit";
import { listSchemaSummaries } from "../service/introspect";
import { applyFilterToList } from "../utils/query";

/**
 * Names a client or a column can carry that `Object.prototype` also answers
 * to (AntelopeJS/dms-database#79, #67).
 */
const PROTOTYPE_NAMES = [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
];

describe("filter modes named like Object.prototype members", () => {
  const rows = [{ a: "foo" }, { a: "bar" }, { a: null }];

  for (const name of [...PROTOTYPE_NAMES, "__proto__"]) {
    it(`ignores the mode '${name}' like any unknown mode`, () => {
      assert.deepEqual(applyFilterToList(rows, "a", `${name}:foo`), rows);
    });
  }
});

describe("edits of fields named like Object.prototype members", () => {
  const row = { _id: "r1", name: "a" };

  for (const name of PROTOTYPE_NAMES) {
    it(`skips a null over the absent cell '${name}'`, () => {
      const updates = buildEditUpdates(row, { [name]: null }, "_id");
      assert.deepEqual(Reflect.ownKeys(updates), []);
    });

    it(`writes a text over the absent cell '${name}' once`, () => {
      const updates = buildEditUpdates(row, { [name]: "text" }, "_id");
      assert.deepEqual(Reflect.ownKeys(updates), [name]);
      assert.equal(
        Object.getOwnPropertyDescriptor(updates, name)?.value,
        "text",
      );
    });
  }

  it("writes an empty object over the absent cell '__proto__'", () => {
    const body = Object.fromEntries([["__proto__", {}]]);
    const updates = buildEditUpdates(row, body, "_id");
    assert.deepEqual(Reflect.ownKeys(updates), ["__proto__"]);
  });
});

const SCHEMA = "own-key-lookups-shop";

@RegisterTable("things", SCHEMA)
class OwnKeyThing extends Table {
  declare _id: string;
}

/** Keeps the decorated class referenced: the decorator registers it. */
const TABLES = [OwnKeyThing];

describe("[integration] table summary of columns named like Object.prototype members", () => {
  before(async () => {
    assert.equal(TABLES.length, 1);
    await RegisterSchema(SCHEMA);
    const schema = Schema.get<{ things: OwnKeyThing }>(SCHEMA);
    assert.ok(schema, "the test schema is registered");
    await schema
      .instance()
      .table("things")
      .insert([
        Object.fromEntries([
          ["_id", "t1"],
          ["name", "n"],
          ["constructor", "c"],
          ["toString", "t"],
        ]),
      ])
      .run();
  });

  after(async () => {
    await Schema.get<{ things: OwnKeyThing }>(SCHEMA)
      ?.instance()
      .table("things")
      .delete()
      .run();
  });

  it("lists every sampled column", async () => {
    const summary = (await listSchemaSummaries()).find((s) => s.id === SCHEMA);
    const table = summary?.tables.find((t) => t.name === "things");
    assert.ok(table, "the table is summarised");
    assert.deepEqual(Object.keys(table.fields).sort(), [
      "_id",
      "constructor",
      "name",
      "toString",
    ]);
  });
});
