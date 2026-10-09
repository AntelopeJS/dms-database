import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import {
  RegisterSchema,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { listSchemaSummaries } from "../service/introspect";

// The Diagram page types an array column by its elements, not as `any[]`
// (D-20): from the elements other than `null`, across the sampled rows.

const SCHEMA = "diagram-arrays";

@RegisterTable("products", SCHEMA)
class DiagramArraysProduct extends Table {
  declare _id: string;
  declare tags: string[];
}

// Keeps the decorated class referenced: the decorator registers it.
const TABLES = [DiagramArraysProduct];

function store() {
  const schema = Schema.get(SCHEMA);
  assert.ok(schema, "the test schema is registered");
  return schema;
}

describe("[integration] Diagram array columns", () => {
  before(async () => {
    assert.equal(TABLES.length, 1);
    await RegisterSchema(SCHEMA);
    await store()
      .instance()
      .table("products" as never)
      .insert([
        { _id: "p-1", tags: [], scores: [], mixed: [1, "a", null] },
        { _id: "p-2", tags: ["office", null, "sale"], scores: [1, 2] },
      ] as never)
      .run();
  });

  after(async () => {
    await store()
      .instance()
      .table("products" as never)
      .delete()
      .run();
  });

  it("types an array by its elements other than null", async () => {
    const fields = (await listSchemaSummaries())
      .find((item) => item.id === SCHEMA)
      ?.tables.find((table) => table.name === "products")?.fields;
    assert.deepEqual(fields?.tags, {
      kind: "array",
      element: { kind: "string" },
    });
    assert.deepEqual(fields?.scores, {
      kind: "array",
      element: { kind: "number" },
    });
    assert.deepEqual(fields?.mixed, {
      kind: "array",
      element: {
        kind: "union",
        members: [{ kind: "number" }, { kind: "string" }],
      },
    });
  });
});
