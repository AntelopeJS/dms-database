import { strict as assert } from "node:assert";
import type { SchemaDefinition } from "@antelopejs/interface-database";
import type {
  ColumnDescription,
  RelationDescription,
} from "@antelopejs/interface-database-catalog";
import {
  catalogDefinitions,
  defineCatalogSchemas,
  ensureCatalogSchemas,
  isCatalogSchema,
  type RelationCatalog,
} from "../service/catalogSchemas";

function column(name: string, ...declared: string[]): ColumnDescription {
  return {
    name,
    native: "text",
    nullable: true,
    hasDefault: false,
    generated: false,
    identity: null,
    accepts: declared.map((entry) => ({ declared: entry })),
    comment: null,
  };
}

function relation(
  schema: string,
  name: string,
  columns: ColumnDescription[],
  extra: Partial<RelationDescription> = {},
): RelationDescription {
  return {
    schema,
    name,
    kind: "table",
    estimatedRows: null,
    estimate: null,
    key: { columns: ["id"], source: "primary" },
    writes: { insert: true, update: true, delete: true },
    comment: null,
    columns,
    indexes: [],
    references: [],
    referencedBy: [],
    ...extra,
  };
}

const ORDERS = relation("public", "orders", [
  column("id", "number", "string"),
  column("total", "number"),
  column("geometry"),
]);
const AUDIT = relation(
  "public",
  "audit_log",
  [column("message", "string"), column("_instance", "string")],
  { key: null },
);
const PARTITION = relation("public", "events_2026", [column("id", "number")], {
  unmappable: "a partition: its parent is the table",
});
const INVOICES = relation("billing", "invoices", [
  column("_id", "string"),
  column("amount", "number"),
]);

/** A binding's `Schema` export that records what it defines and lists it as the real one does. */
function fakeRegistry(preset: Record<string, SchemaDefinition> = {}) {
  const defined = new Map<string, FakeSchema>();
  const definitions = new Map<string, SchemaDefinition>();
  class FakeSchema {
    static list(): ReadonlyMap<string, FakeSchema> {
      return defined;
    }

    constructor(
      readonly id: string,
      definition: SchemaDefinition,
    ) {
      defined.set(id, this);
      definitions.set(id, definition);
    }
  }
  for (const [id, definition] of Object.entries(preset)) {
    new FakeSchema(id, definition);
  }
  definitions.clear();
  return { registry: FakeSchema, defined, definitions };
}

/** A catalog that describes the relations, or refuses as it does outside development. */
function fakeCatalog(
  described: RelationDescription[] | Error,
): RelationCatalog {
  const answer = async () => {
    if (described instanceof Error) throw described;
    return described;
  };
  return {
    ListRelations: answer,
    DescribeRelations: async (names) =>
      (await answer()).filter(({ schema, name }) =>
        names.includes(`${schema}.${name}`),
      ),
  };
}

const run = (work: () => void): void => work();

describe("the schemas a catalog defines for a connected database", () => {
  it("declares each table as a generated module would: _id for a keyed relation, each column as its first accepted declaration", () => {
    const definitions = catalogDefinitions(
      [ORDERS, AUDIT, INVOICES],
      new Set(),
    );
    assert.deepEqual(Object.fromEntries(definitions), {
      public: {
        orders: {
          fields: { _id: "string", id: "number", total: "number" },
          indexes: {},
        },
        audit_log: { fields: { message: "string" }, indexes: {} },
      },
      billing: {
        invoices: { fields: { _id: "string", amount: "number" }, indexes: {} },
      },
    });
  });

  it("leaves out a relation the provider cannot register and a schema another module defines", () => {
    const definitions = catalogDefinitions(
      [ORDERS, PARTITION, INVOICES],
      new Set(["billing"]),
    );
    assert.deepEqual([...definitions.keys()], ["public"]);
    assert.deepEqual(Object.keys(definitions.get("public") ?? {}), ["orders"]);
  });
});

describe("defining a connection's catalog schemas on its binding", () => {
  it("defines the schemas no module defines and marks them, leaving a module's own schema as it is", async () => {
    const own = { customers: { fields: { _id: "string" }, indexes: {} } };
    const { registry, defined, definitions } = fakeRegistry({ billing: own });
    const before = defined.get("billing");
    const outcome = await defineCatalogSchemas(
      "shop",
      registry,
      fakeCatalog([ORDERS, INVOICES]),
      run,
    );
    assert.equal(outcome, "settled");
    assert.deepEqual([...definitions.keys()], ["public"]);
    assert.equal(defined.get("billing"), before);
    const publicSchema = defined.get("public");
    assert.ok(publicSchema);
    assert.equal(isCatalogSchema(publicSchema), true);
    assert.ok(before);
    assert.equal(isCatalogSchema(before), false);
  });

  it("defines again a schema it defined in an earlier generation, which core unregistered when the module reloaded", async () => {
    const { registry, definitions } = fakeRegistry();
    await defineCatalogSchemas("shop", registry, fakeCatalog([ORDERS]), run);
    definitions.clear();
    await defineCatalogSchemas("shop", registry, fakeCatalog([ORDERS]), run);
    assert.deepEqual([...definitions.keys()], ["public"]);
  });

  it("defines nothing when the catalog refuses, as it does outside development", async () => {
    const { registry, definitions } = fakeRegistry();
    const outcome = await defineCatalogSchemas(
      "shop",
      registry,
      fakeCatalog(new Error("outside development")),
      run,
    );
    assert.equal(outcome, "settled");
    assert.equal(definitions.size, 0);
  });

  it("asks the catalog once per connection, and again only after a catalog that did not answer in time", async () => {
    let answers: ("settled" | "retry")[] = ["retry", "settled"];
    let calls = 0;
    const define = async () => {
      calls += 1;
      const [next, ...rest] = answers;
      answers = rest;
      return next ?? "settled";
    };
    await ensureCatalogSchemas("ensure-test", define);
    await ensureCatalogSchemas("ensure-test", define);
    await ensureCatalogSchemas("ensure-test", define);
    assert.equal(calls, 2);
  });
});
