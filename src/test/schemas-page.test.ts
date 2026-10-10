import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import {
  RegisterSchema,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { DatabaseTablesController } from "../routes/tables";
import { listSchemaSummaries } from "../service/introspect";
import {
  decodeInstanceParam,
  parseHasFlags,
  readSchemaFilters,
} from "../service/schemaFilters";

// The Schemas page: rows counted across instances (S-7), columns holding
// `null` shown nullable (S-8), and the filter bar's filters on the source.

const SCHEMA = "schemas-page-shop";
const REGIONS = ["eu", "us"];
const USER = { _id: "schemas-page-user", language: "en" } as User;

@RegisterTable("invoices", SCHEMA)
class SchemasPageInvoice extends Table {
  declare _id: string;
  declare number: string;
  declare coupon_id: string | null;
}

// Keeps the decorated class referenced: the decorator registers it.
const TABLES = [SchemasPageInvoice];

function shop() {
  const schema = Schema.get(SCHEMA);
  assert.ok(schema, "the test schema is registered");
  return schema;
}

async function seed(): Promise<void> {
  assert.equal(TABLES.length, 1);
  await RegisterSchema(SCHEMA);
  await shop()
    .instance()
    .table("invoices" as never)
    .insert([
      { _id: "inv-1", number: "F-1", coupon_id: "cpn_SPRING5" },
      { _id: "inv-2", number: "F-2", coupon_id: null },
    ] as never)
    .run();
  for (const region of REGIONS) {
    await shop()
      .createInstance(region)
      .run()
      .catch(() => undefined);
    const rows = [1, 2].map((index) => ({
      _id: `${region}-inv-${index}`,
      number: `F-${region}-${index}`,
      coupon_id: index === 1 ? "cpn_AUTUMN10" : null,
    }));
    await shop()
      .instance(region)
      .table("invoices" as never)
      .insert(rows as never)
      .run();
  }
}

async function cleanUp(): Promise<void> {
  for (const region of REGIONS) await shop().destroyInstance(region).run();
  await shop()
    .instance()
    .table("invoices" as never)
    .delete()
    .run();
}

describe("[integration] Schemas page", () => {
  before(seed);
  after(cleanUp);

  // The source as the table view calls it, with the bar's hidden filters.
  function listed(bar: { instance?: string; q?: string; has?: string } = {}) {
    const asFilter = (value?: string) => (value ? `is:${value}` : undefined);
    return new DatabaseTablesController().source(
      USER,
      `is:${SCHEMA}`,
      asFilter(bar.instance),
      asFilter(bar.q),
      asFilter(bar.has),
    );
  }

  it("lists a table's rows in every instance", async () => {
    const { results, total, all } = await listed({ instance: "all" });
    assert.deepEqual(
      results.map((row) => [row.name, row.elementCount]),
      [["invoices", 6]],
    );
    assert.equal(total, 1);
    assert.ok(all >= 1, "counts every registered table");
  });

  it("counts the rows of the instance the bar picked", async () => {
    const named = await listed({ instance: "eu" });
    assert.deepEqual(
      named.results.map((row) => row.elementCount),
      [2],
    );
    const fallback = await listed();
    assert.deepEqual(
      fallback.results.map((row) => row.elementCount),
      [2],
    );
  });

  it("finds a table by one of its column names", async () => {
    assert.equal((await listed({ q: "COUPON" })).total, 1);
    assert.equal((await listed({ q: "no-such-column" })).total, 0);
  });

  it("filters on structure and on empty tables", async () => {
    assert.equal((await listed({ has: "relations" })).total, 0);
    assert.equal((await listed({ has: "modifiers" })).total, 0);
    assert.equal((await listed({ has: "empty", instance: "all" })).total, 0);
    assert.equal(
      (await listed({ has: "empty", instance: "no-such-instance" })).total,
      1,
    );
  });

  it("searches a schema's named instances", async () => {
    const controller = new DatabaseTablesController();
    assert.deepEqual(await controller.instances(SCHEMA, "U", undefined), {
      instances: ["eu", "us"],
      total: 2,
    });
    assert.deepEqual(await controller.instances(SCHEMA, undefined, "1"), {
      instances: ["eu"],
      total: 2,
    });
    await assert.rejects(
      controller.instances("no-such-schema", undefined, undefined),
      (error: { getStatus(): number }) => error.getStatus() === 404,
    );
  });

  it("types a column holding null as nullable", async () => {
    const summary = (await listSchemaSummaries()).find(
      (item) => item.id === SCHEMA,
    );
    const fields = summary?.tables.find(
      (table) => table.name === "invoices",
    )?.fields;
    assert.deepEqual(fields?.coupon_id, {
      kind: "union",
      members: [{ kind: "string" }, { kind: "null" }],
    });
    assert.deepEqual(fields?.number, { kind: "string" });
  });
});

describe("Schemas filter bar parameters", () => {
  it("reads the default instance, every instance and named ones", () => {
    assert.deepEqual(decodeInstanceParam(undefined), { kind: "default" });
    assert.deepEqual(decodeInstanceParam(""), { kind: "default" });
    assert.deepEqual(decodeInstanceParam("all"), { kind: "all" });
    assert.deepEqual(decodeInstanceParam("default"), {
      kind: "named",
      id: "default",
    });
    assert.deepEqual(decodeInstanceParam("eu"), { kind: "named", id: "eu" });
  });

  it("keeps known structure flags, once each", () => {
    assert.deepEqual(parseHasFlags("empty, relations,bogus,empty"), [
      "relations",
      "empty",
    ]);
    assert.deepEqual(parseHasFlags(undefined), []);
  });

  it("reads the hidden filters the table view sends", () => {
    const filters = readSchemaFilters({
      scope: "is:shop",
      instance: "is:",
      q: "is: invoice ",
      has: undefined,
    });
    assert.equal(filters.scope, "shop");
    assert.deepEqual(filters.instance, { kind: "default" });
    assert.equal(filters.q, "invoice");
    assert.deepEqual(filters.has, []);
  });
});
