import { strict as assert } from "node:assert";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { DiagramLayoutModel, DiagramNoteModel } from "../db";
import { DatabaseDiagramController } from "../routes/diagram";
import type { JsonValue } from "../types/json";
import { refusal } from "./refusal";

const SCHEMA_NAME = "diagram-routes-shop";
const OTHER_SCHEMA_NAME = "diagram-routes-other";
const USER = Object.assign(new User(), { _id: "diagram-routes-user" });

type NoteBody = Parameters<DatabaseDiagramController["createNote"]>[1];

const NOTE: NoteBody = {
  schemaName: SCHEMA_NAME,
  x: 10,
  y: 20,
  width: 200,
  height: 80,
};

async function clearAll(): Promise<void> {
  for (const schemaName of [SCHEMA_NAME, OTHER_SCHEMA_NAME]) {
    const notes = await GetModel(DiagramNoteModel).listBySchema(schemaName);
    for (const note of notes) await GetModel(DiagramNoteModel).delete(note._id);
    const layout = await GetModel(DiagramLayoutModel).getBySchema(schemaName);
    if (layout) await GetModel(DiagramLayoutModel).delete(layout._id);
  }
}

function withCleanTables(): void {
  before(clearAll);
  after(clearAll);
}

describe("[integration] diagram layout routes", () => {
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
      await controller.putLayout(USER, SCHEMA_NAME, {
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
    await controller.putLayout(USER, SCHEMA_NAME, {
      positions: { orders: { x: 3, y: 4 } },
    });
    assert.deepEqual(await controller.getLayout(USER, SCHEMA_NAME), {
      positions: { orders: { x: 3, y: 4 } },
    });
  });

  it("refuses a layout that is not an object of finite positions", async () => {
    const controller = new DatabaseDiagramController();
    const put = (positions: JsonValue | undefined) =>
      refusal(controller.putLayout(USER, SCHEMA_NAME, { positions }));
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
      await refusal(controller.putLayout(USER, "", { positions: {} })),
      { ...expected, message: "Expected non-empty string" },
    );
    assert.deepEqual(await refusal(controller.getLayout(USER, undefined)), {
      ...expected,
      message: "Expected non-empty string",
    });
  });

  it("keeps a stored layout that no longer parses from failing the read", async () => {
    const layouts = GetModel(DiagramLayoutModel);
    await layouts.insert({
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
    const created = await controller.createNote(USER, {
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
    const bare = await controller.createNote(USER, { ...NOTE, text: 5 });
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

    const patched = await controller.updateNote(USER, created.id, {
      text: "kept",
      x: 99,
      color: "blue",
    });
    assert.equal(patched.text, "kept");
    assert.deepEqual(
      [patched.x, patched.y, patched.width, patched.height, patched.color],
      [99, 20, 200, 80, "blue"],
    );
    const textless = await controller.updateNote(USER, created.id, {
      text: 7,
    });
    assert.equal(textless.text, "");
    assert.equal(textless.x, 99);

    assert.deepEqual(await controller.deleteNote(USER, created.id), {
      success: true,
    });
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
      refusal(controller.createNote(USER, body));
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

  it("answers 404 for a note that does not exist and 400 for a bad patch", async () => {
    const controller = new DatabaseDiagramController();
    assert.deepEqual(
      await refusal(controller.updateNote(USER, "missing-note", {})),
      { status: 404, message: "Note not found" },
    );
    assert.deepEqual(
      await refusal(controller.deleteNote(USER, "missing-note")),
      { status: 404, message: "Note not found" },
    );
    assert.deepEqual(await refusal(controller.deleteNote(USER, "")), {
      status: 400,
      message: "Expected non-empty string",
    });
    const note = await controller.createNote(USER, NOTE);
    assert.deepEqual(
      await refusal(controller.updateNote(USER, note.id, { width: "wide" })),
      { status: 400, message: "Expected finite number for width" },
    );
    assert.equal(
      (await controller.updateNote(USER, note.id, {})).width,
      200,
      "an empty patch keeps the note",
    );
  });
});
