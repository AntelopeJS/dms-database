import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import {
  RegisterSchema,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { formatModifier } from "../i18n/messages";
import { DatabaseBrowseController } from "../routes/data";
import { describeUnknownQueryTarget } from "../service/queryInspection";
import { buildEditUpdates } from "../service/rowEdit";
import { listSchemaSummaries } from "../service/introspect";
import { applyFilterToList } from "../utils/query";
import { refusal } from "./refusal";

/**
 * Names a client, a column, a table or a modifier can carry that
 * `Object.prototype` also answers to (AntelopeJS/dms-database#79, #67, #69).
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

describe("filter columns named like Object.prototype members", () => {
  const rows = [{ a: "foo" }, { a: "bar" }];

  for (const name of PROTOTYPE_NAMES) {
    it(`reads the absent column '${name}' as empty`, () => {
      assert.deepEqual(applyFilterToList(rows, name, "contains:function"), []);
      assert.deepEqual(applyFilterToList(rows, name, "is:"), rows);
    });
  }

  it("reads an own column named like a prototype member", () => {
    const own = [{ constructor: "kept" }, { constructor: "other" }];
    assert.deepEqual(applyFilterToList(own, "constructor", "is:kept"), [
      own[0],
    ]);
  });
});

describe("edits of fields named like Object.prototype members", () => {
  const row = new Map(Object.entries({ _id: "r1", name: "a" }));

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
    const schema = Schema.get(SCHEMA);
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
          ["__proto__", "p"],
        ]),
      ])
      .run();
  });

  after(async () => {
    await Schema.get(SCHEMA)?.instance().table("things").delete().run();
  });

  it("lists every sampled column", async () => {
    const summary = (await listSchemaSummaries()).find((s) => s.id === SCHEMA);
    const table = summary?.tables.find((t) => t.name === "things");
    assert.ok(table, "the table is summarised");
    assert.deepEqual(Object.keys(table.fields).sort(), [
      "__proto__",
      "_id",
      "constructor",
      "name",
      "toString",
    ]);
  });

  it("sends a column named __proto__ as a column on the wire", async () => {
    const summary = (await listSchemaSummaries()).find((s) => s.id === SCHEMA);
    const table = summary?.tables.find((t) => t.name === "things");
    assert.match(
      JSON.stringify(table?.fields) ?? "",
      /"__proto__":\{"kind":"string"\}/,
      "the JSON body holds __proto__ as a column",
    );
  });
});

describe("column modifiers named like Object.prototype members", () => {
  for (const name of PROTOTYPE_NAMES) {
    it(`names the undeclared modifier '${name}' by its id`, () => {
      assert.equal(formatModifier("en", name), name);
    });
  }
});

describe("[integration] tables named like Object.prototype members", () => {
  const user = Object.assign(new User(), { _id: "own-key-lookups-user" });

  before(async () => {
    await RegisterSchema(SCHEMA);
  });

  for (const name of [...PROTOTYPE_NAMES, "__proto__"]) {
    it(`refuses to browse the undeclared table '${name}'`, async () => {
      const controller = new DatabaseBrowseController();
      assert.deepEqual(
        await refusal(
          controller.count(user, `is:${SCHEMA}`, undefined, `is:${name}`),
        ),
        { status: 404, message: `Unknown table: ${name}` },
      );
    });

    it(`reports a query on the undeclared table '${name}'`, async () => {
      assert.equal(
        await describeUnknownQueryTarget({ schema: SCHEMA, table: name }),
        `Unknown table "${name}" in schema ${SCHEMA}`,
      );
    });
  }

  it("reports no declared table as unknown", async () => {
    assert.equal(
      await describeUnknownQueryTarget({ schema: SCHEMA, table: "things" }),
      null,
    );
  });
});
