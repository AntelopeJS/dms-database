import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import { User } from "@antelopejs/interface-dms/auth/db";
import { DatabaseBrowseController } from "../routes/data";
import { DatabaseTablesController } from "../routes/tables";
import type { JsonObject, JsonValue } from "../types/json";
import { refusal } from "./refusal";
import { requestContext } from "./requestContext";

const SCHEMA = "browse-routes-qa";
const USER = Object.assign(new User(), { _id: "browse-routes-user" });

interface ItemRow {
  _id: string;
  name: string;
  count: number | null;
  tags?: string[];
}

const schema = new Schema<{ items: ItemRow }>(SCHEMA, {
  items: { fields: { _id: "string", name: "string" }, indexes: {} },
});

const IS_SCHEMA = `is:${SCHEMA}`;
const IS_ITEMS = "is:items";

const INSTANCES = ["alpha", "Beta", "gamma-10", "gamma-2"];

function withItems(): void {
  before(async () => {
    for (const id of INSTANCES) {
      await schema
        .createInstance(id)
        .run()
        .catch(() => undefined);
    }
  });

  beforeEach(async () => {
    const items = schema.instance("alpha").table("items");
    await items.delete().run();
    await items
      .insert([
        { _id: "i1", name: "first", count: null },
        { _id: "i2", name: "second", count: 5, tags: ["x"] },
      ])
      .run();
  });

  after(async () => {
    for (const id of INSTANCES) await schema.destroyInstance(id).run();
  });
}

describe("[integration] browse routes: selection and reads", () => {
  withItems();

  it("reads the selection from the three filters and refuses a bad one", async () => {
    const controller = new DatabaseBrowseController();
    assert.deepEqual(
      await controller.count(USER, IS_SCHEMA, "is:alpha", IS_ITEMS),
      { total: 2 },
    );
    const count = (
      schemaFilter: JsonValue | undefined,
      tableFilter: JsonValue | undefined,
    ) => refusal(controller.count(USER, schemaFilter, "is:alpha", tableFilter));
    assert.deepEqual(await count(undefined, IS_ITEMS), {
      status: 400,
      message: "Missing 'schema' filter",
    });
    assert.deepEqual(await count("contains:browse", IS_ITEMS), {
      status: 400,
      message: "Missing 'schema' filter",
    });
    assert.deepEqual(await count(IS_SCHEMA, ""), {
      status: 400,
      message: "Missing 'table' filter",
    });
    assert.deepEqual(await count(IS_SCHEMA, ["is:items"]), {
      status: 400,
      message: "Missing 'table' filter",
    });
    assert.deepEqual(await count("is:nope", IS_ITEMS), {
      status: 404,
      message: "Unknown schema: nope",
    });
    assert.deepEqual(await count(IS_SCHEMA, "is:nothing"), {
      status: 404,
      message: "Unknown table: nothing",
    });
  });

  it("describes the columns and their coarse types from a sample", async () => {
    const controller = new DatabaseBrowseController();
    assert.deepEqual(
      await controller.columns(USER, IS_SCHEMA, "is:alpha", IS_ITEMS),
      {
        columns: ["_id", "name", "count", "_instance", "tags"],
        types: {
          _id: "string",
          _instance: "string",
          name: "string",
          count: "number",
          tags: "array",
        },
        primaryKey: null,
      },
    );
  });

  it("lists the tables of a schema with their row counts in one instance", async () => {
    const controller = new DatabaseBrowseController();
    assert.deepEqual(await controller.tables(USER, IS_SCHEMA, "is:alpha"), {
      items: [{ name: "items", elementCount: 2 }],
    });
    assert.deepEqual(await controller.tables(USER, IS_SCHEMA, "is:Beta"), {
      items: [{ name: "items", elementCount: 0 }],
    });
    assert.deepEqual(await refusal(controller.tables(USER, "", "is:alpha")), {
      status: 400,
      message: "Missing 'schema' filter",
    });
    assert.deepEqual(await refusal(controller.tables(USER, "is:nope", "")), {
      status: 404,
      message: "Unknown schema: nope",
    });
  });
});

describe("[integration] browse routes: rows", () => {
  withItems();

  it("reads one row by its id and refuses a missing or unknown one", async () => {
    const controller = new DatabaseBrowseController();
    const row: unknown = await controller.get(
      USER,
      IS_SCHEMA,
      "is:alpha",
      IS_ITEMS,
      "i2",
    );
    assert.deepEqual(row, {
      _id: "i2",
      _instance: "alpha",
      name: "second",
      count: 5,
      tags: ["x"],
    });
    const get = (id: JsonValue | undefined) =>
      refusal(controller.get(USER, IS_SCHEMA, "is:alpha", IS_ITEMS, id));
    assert.deepEqual(await get(undefined), {
      status: 400,
      message: "Missing 'id'",
    });
    assert.deepEqual(await get(""), { status: 400, message: "Missing 'id'" });
    assert.deepEqual(await get(7), { status: 400, message: "Missing 'id'" });
    assert.deepEqual(await get("nothing"), {
      status: 404,
      message: "Row not found",
    });
  });

  it("counts the rows of other tables pointing at a row, in one instance", async () => {
    const controller = new DatabaseBrowseController();
    const references = (instance: string, id: JsonValue | undefined) =>
      refusal(controller.references(USER, IS_SCHEMA, instance, IS_ITEMS, id));
    assert.deepEqual(await references("is:alpha", ""), {
      status: 400,
      message: "Missing 'id'",
    });
    assert.deepEqual(await references("is:alpha", "nothing"), {
      status: 404,
      message: "Row not found",
    });
    assert.deepEqual(await references("is:__CROSS_INSTANCE__", "i1"), {
      status: 400,
      message: "Pick one instance to read a row's references",
    });
    assert.deepEqual(
      await controller.references(USER, IS_SCHEMA, "is:alpha", IS_ITEMS, "i1"),
      { items: [] },
    );
  });
});

describe("[integration] browse routes: edits", () => {
  withItems();

  it("refuses an edit across instances, without an id or with a bad body", async () => {
    const controller = new DatabaseBrowseController();
    const edit = (
      instance: string,
      id: JsonValue | undefined,
      body: JsonObject,
    ) =>
      refusal(controller.edit(USER, IS_SCHEMA, instance, IS_ITEMS, id, body));
    assert.deepEqual(await edit("is:__CROSS_INSTANCE__", "i1", {}), {
      status: 400,
      message: "Editing is disabled when browsing across all instances",
    });
    assert.deepEqual(await edit("is:alpha", undefined, {}), {
      status: 400,
      message: "Missing 'id'",
    });
    assert.deepEqual(
      await refusal(
        controller.edit(USER, IS_SCHEMA, "is:alpha", IS_ITEMS, "i1", []),
      ),
      { status: 400, message: "Invalid request body" },
    );
    assert.deepEqual(
      await refusal(
        controller.edit(USER, IS_SCHEMA, "is:alpha", IS_ITEMS, "i1", undefined),
      ),
      { status: 400, message: "Invalid request body" },
    );
    assert.deepEqual(await edit("is:alpha", "nothing", { name: "x" }), {
      status: 404,
      message: "Row not found",
    });
  });

  it("edits only what changed and skips the protected and the empty", async () => {
    const controller = new DatabaseBrowseController();
    const edit = (body: JsonObject) =>
      controller.edit(USER, IS_SCHEMA, "is:alpha", IS_ITEMS, "i2", body);
    assert.deepEqual(
      await edit({ name: "second", count: "5", _id: "other", _instance: "x" }),
      { _id: "i2", _instance: "alpha", name: "second", count: 5, tags: ["x"] },
      "an unchanged echo, the id and the instance tag are not written",
    );
    assert.deepEqual(
      await edit({ name: "renamed", count: Number.NaN, tags: ["x", "y"] }),
      {
        _id: "i2",
        _instance: "alpha",
        name: "renamed",
        count: 5,
        tags: ["x", "y"],
      },
    );
    assert.deepEqual(await edit({ count: null }), {
      _id: "i2",
      _instance: "alpha",
      name: "renamed",
      count: null,
      tags: ["x", "y"],
    });
    assert.deepEqual(
      await edit({ count: null }),
      {
        _id: "i2",
        _instance: "alpha",
        name: "renamed",
        count: null,
        tags: ["x", "y"],
      },
      "clearing an empty cell writes nothing",
    );
  });
});

describe("[integration] table routes", () => {
  withItems();

  it("serves a table's row by id and refuses an unknown one", async () => {
    const controller = new DatabaseTablesController();
    assert.deepEqual(await refusal(controller.sourceRow(USER, undefined)), {
      status: 400,
      message: "Missing 'id'",
    });
    assert.deepEqual(
      await refusal(controller.sourceRow(USER, `${SCHEMA}::nothing`)),
      { status: 404, message: `Unknown table ${SCHEMA}::nothing` },
    );
    const row = await controller.sourceRow(USER, `${SCHEMA}::items`);
    assert.equal(row.id, `${SCHEMA}::items`);
    assert.equal(row.name, "items");
  });

  it("searches a schema's named instances and caps the answer", async () => {
    const controller = new DatabaseTablesController();
    assert.deepEqual(await controller.instances(SCHEMA, undefined, undefined), {
      instances: ["alpha", "Beta", "gamma-2", "gamma-10"],
      total: 4,
    });
    assert.deepEqual(await controller.instances(SCHEMA, "GAMMA", undefined), {
      instances: ["gamma-2", "gamma-10"],
      total: 2,
    });
    assert.deepEqual(await controller.instances(SCHEMA, "", "2"), {
      instances: ["alpha", "Beta"],
      total: 4,
    });
    assert.deepEqual(await controller.instances(SCHEMA, undefined, "zero"), {
      instances: ["alpha", "Beta", "gamma-2", "gamma-10"],
      total: 4,
    });
    assert.deepEqual(
      await refusal(controller.instances(undefined, undefined, undefined)),
      { status: 400, message: "Missing 'schema'" },
    );
    assert.deepEqual(
      await refusal(controller.instances("nope", undefined, undefined)),
      { status: 404, message: "Unknown schema nope" },
    );
  });

  it("builds a request context a controller can read filters from", async () => {
    const controller = new DatabaseBrowseController();
    const page = await controller.list(
      USER,
      requestContext("https://example.test/?filter_name=contains:SEC"),
      IS_SCHEMA,
      "is:alpha",
      IS_ITEMS,
      undefined,
      undefined,
      "name",
      "desc",
      undefined,
    );
    assert.deepEqual(
      page.results.map<unknown>((row) => row._id),
      ["i2"],
    );
    assert.equal(page.total, 1);
    assert.equal(page.primaryKey, undefined);
  });
});
