import { strict as assert } from "node:assert";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { DiagramLayoutModel, DiagramNoteModel } from "../db";
import { DatabaseDiagramController } from "../routes/diagram";
import { OWN_CONNECTION } from "../types/constants";
import type { JsonValue } from "../types/json";
import { refusal } from "./refusal";
import { LOADED_HOST_TIMEOUT_MS } from "./helpers/timeouts";

const SCHEMA_NAME = "diagram-routes-shop";
const OTHER_SCHEMA_NAME = "diagram-routes-other";
const RACED_SCHEMAS = 50;
const SAVES_PER_SCHEMA = 8;
const USER = Object.assign(new User(), { _id: "diagram-routes-user" });

type NoteBody = Parameters<DatabaseDiagramController["createNote"]>[2];

const NOTE: NoteBody = {
  schemaName: SCHEMA_NAME,
  x: 10,
  y: 20,
  width: 200,
  height: 80,
};

async function clearAll(): Promise<void> {
  for (const schemaName of [SCHEMA_NAME, OTHER_SCHEMA_NAME]) {
    const notes = await GetModel(DiagramNoteModel).listFor(
      OWN_CONNECTION,
      schemaName,
    );
    for (const note of notes) await GetModel(DiagramNoteModel).delete(note._id);
    const layout = await GetModel(DiagramLayoutModel).getFor(
      OWN_CONNECTION,
      schemaName,
    );
    if (layout) await GetModel(DiagramLayoutModel).delete(layout._id);
  }
}

function withCleanTables(): void {
  before(clearAll);
  after(clearAll);
}

describe("[integration] diagram layout routes", function () {
  this.timeout(LOADED_HOST_TIMEOUT_MS);

  withCleanTables();

  it("answers an empty layout for a schema that has none", async () => {
    const controller = new DatabaseDiagramController();
    assert.deepEqual(await controller.getLayout(USER, SCHEMA_NAME), {
      positions: {},
    });
  });

  it("stores the x and y of each position and reads them back", async () => {
    const controller = new DatabaseDiagramController();
    const positions = { orders: { x: 1.5, y: -2 }, customers: { x: 0, y: 8 } };
    assert.deepEqual(
      await controller.putLayout(USER, OWN_CONNECTION, SCHEMA_NAME, {
        positions: {
          orders: { x: 1.5, y: -2, extra: "dropped" },
          customers: { x: 0, y: 8 },
        },
      }),
      { success: true },
    );
    assert.deepEqual(await controller.getLayout(USER, SCHEMA_NAME), {
      positions,
    });
    await controller.putLayout(USER, OWN_CONNECTION, SCHEMA_NAME, {
      positions: { orders: { x: 3, y: 4 } },
    });
    assert.deepEqual(await controller.getLayout(USER, SCHEMA_NAME), {
      positions: { orders: { x: 3, y: 4 } },
    });
  });

  it("refuses a layout that is not an object of finite positions", async () => {
    const controller = new DatabaseDiagramController();
    const put = (positions: JsonValue | undefined) =>
      refusal(
        controller.putLayout(USER, OWN_CONNECTION, SCHEMA_NAME, { positions }),
      );
    const expected = { status: 400 };
    assert.deepEqual(await put(undefined), {
      ...expected,
      message: "Expected positions object",
    });
    assert.deepEqual(await put([]), {
      ...expected,
      message: "Expected positions object",
    });
    assert.deepEqual(await put("orders"), {
      ...expected,
      message: "Expected positions object",
    });
    assert.deepEqual(await put({ orders: 4 }), {
      ...expected,
      message: "Invalid position for orders",
    });
    assert.deepEqual(await put({ orders: null }), {
      ...expected,
      message: "Invalid position for orders",
    });
    assert.deepEqual(await put({ orders: { x: 1 } }), {
      ...expected,
      message: "Expected finite number for orders.y",
    });
    assert.deepEqual(await put({ orders: { x: "1", y: 2 } }), {
      ...expected,
      message: "Expected finite number for orders.x",
    });
    assert.deepEqual(await put({ orders: [1, 2] }), {
      ...expected,
      message: "Expected finite number for orders.x",
    });
    assert.deepEqual(
      await refusal(
        controller.putLayout(USER, OWN_CONNECTION, "", { positions: {} }),
      ),
      { ...expected, message: "Expected non-empty string" },
    );
    assert.deepEqual(await refusal(controller.getLayout(USER, undefined)), {
      ...expected,
      message: "Expected non-empty string",
    });
  });

  it("keeps one layout row when saves of a new schema race", async () => {
    const controller = new DatabaseDiagramController();
    const layouts = GetModel(DiagramLayoutModel);
    const schemas = Array.from(
      { length: RACED_SCHEMAS },
      (_, index) => `${OTHER_SCHEMA_NAME}-${index}`,
    );
    const saveAll = (schema: string) =>
      Promise.all(
        Array.from({ length: SAVES_PER_SCHEMA }, (_, x) =>
          controller.putLayout(USER, OWN_CONNECTION, schema, {
            positions: { orders: { x, y: 0 } },
          }),
        ),
      );
    try {
      await Promise.all(schemas.map(saveAll));
      for (const schema of schemas)
        assert.equal((await layouts.getBy("schemaName", schema)).length, 1);
    } finally {
      for (const schema of schemas)
        for (const row of await layouts.getBy("schemaName", schema))
          await layouts.delete(row._id);
    }
  });

  it("keeps a stored layout that no longer parses from failing the read", async () => {
    const layouts = GetModel(DiagramLayoutModel);
    await layouts.insert({
      _id: OTHER_SCHEMA_NAME,
      schemaName: OTHER_SCHEMA_NAME,
      positions: "{not json",
      updatedAt: new Date(),
    });
    const controller = new DatabaseDiagramController();
    assert.deepEqual(await controller.getLayout(USER, OTHER_SCHEMA_NAME), {
      positions: {},
    });
  });
});

describe("[integration] diagram note routes", () => {
  withCleanTables();

  it("creates, lists, patches and deletes a note", async () => {
    const controller = new DatabaseDiagramController();
    const created = await controller.createNote(USER, OWN_CONNECTION, {
      ...NOTE,
      text: "orders are archived monthly",
      color: "amber",
    });
    assert.equal(created.schemaName, SCHEMA_NAME);
    assert.equal(created.text, "orders are archived monthly");
    assert.equal(created.color, "amber");
    assert.deepEqual(
      [created.x, created.y, created.width, created.height],
      [10, 20, 200, 80],
    );
    const bare = await controller.createNote(USER, OWN_CONNECTION, {
      ...NOTE,
      text: 5,
    });
    assert.equal(bare.text, "");
    assert.equal(bare.color, null);

    const listed = await controller.listNotes(USER, SCHEMA_NAME);
    assert.deepEqual(
      listed.items.map((item) => item.id),
      [created.id, bare.id],
    );
    assert.deepEqual(await controller.listNotes(USER, OTHER_SCHEMA_NAME), {
      items: [],
    });

    const patched = await controller.updateNote(
      USER,
      OWN_CONNECTION,
      created.id,
      {
        text: "kept",
        x: 99,
        color: "blue",
      },
    );
    assert.equal(patched.text, "kept");
    assert.deepEqual(
      [patched.x, patched.y, patched.width, patched.height, patched.color],
      [99, 20, 200, 80, "blue"],
    );
    const textless = await controller.updateNote(
      USER,
      OWN_CONNECTION,
      created.id,
      {
        text: 7,
      },
    );
    assert.equal(textless.text, "");
    assert.equal(textless.x, 99);

    assert.deepEqual(
      await controller.deleteNote(USER, OWN_CONNECTION, created.id),
      {
        success: true,
      },
    );
    assert.deepEqual(
      (await controller.listNotes(USER, SCHEMA_NAME)).items.map(
        (item) => item.id,
      ),
      [bare.id],
    );
  });

  it("refuses a note without a schema, a position or a size", async () => {
    const controller = new DatabaseDiagramController();
    const create = (body: NoteBody) =>
      refusal(controller.createNote(USER, OWN_CONNECTION, body));
    assert.deepEqual(await create({ ...NOTE, schemaName: "" }), {
      status: 400,
      message: "Expected non-empty string",
    });
    assert.deepEqual(await create({ ...NOTE, x: undefined }), {
      status: 400,
      message: "Expected finite number for x",
    });
    assert.deepEqual(await create({ ...NOTE, y: Number.NaN }), {
      status: 400,
      message: "Expected finite number for y",
    });
    assert.deepEqual(await create({ ...NOTE, width: "200" }), {
      status: 400,
      message: "Expected finite number for width",
    });
    assert.deepEqual(await create({ ...NOTE, height: null }), {
      status: 400,
      message: "Expected finite number for height",
    });
  });
});

describe("[integration] diagram note refusals", () => {
  withCleanTables();

  it("answers 404 for a note that does not exist and 400 for a bad patch", async () => {
    const controller = new DatabaseDiagramController();
    assert.deepEqual(
      await refusal(
        controller.updateNote(USER, OWN_CONNECTION, "missing-note", {}),
      ),
      { status: 404, message: "Note not found" },
    );
    assert.deepEqual(
      await refusal(
        controller.deleteNote(USER, OWN_CONNECTION, "missing-note"),
      ),
      { status: 404, message: "Note not found" },
    );
    assert.deepEqual(
      await refusal(controller.deleteNote(USER, OWN_CONNECTION, "")),
      {
        status: 400,
        message: "Expected non-empty string",
      },
    );
    const note = await controller.createNote(USER, OWN_CONNECTION, NOTE);
    assert.deepEqual(
      await refusal(
        controller.updateNote(USER, OWN_CONNECTION, note.id, { width: "wide" }),
      ),
      { status: 400, message: "Expected finite number for width" },
    );
    assert.equal(
      (await controller.updateNote(USER, OWN_CONNECTION, note.id, {})).width,
      200,
      "an empty patch keeps the note",
    );
  });
});
