import { strict as assert } from "node:assert";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { DiagramLayoutModel, DiagramNoteModel } from "../db";
import { OWN_CONNECTION } from "../types/constants";
import type { JsonObject, JsonValue } from "../types/json";
import { call } from "./helpers/http";
import { at, itemsAt, textAt } from "./helpers/jsonAt";
import {
  createMemberSession,
  createOwnerSession,
  type OwnerSession,
} from "./ownerSession";

const SHOP = "diagram-journeys-shop";
const VAULT = "diagram-journeys-vault";
const UNKNOWN = "diagram-journeys-none";
const NOTES = "/database/diagram/notes";
const NOTE: JsonObject = {
  schemaName: SHOP,
  text: "reorder",
  x: 12.5,
  y: -40,
  width: 220,
  height: 140,
};

let owner: OwnerSession;
let member: OwnerSession;

async function clearAll(): Promise<void> {
  const notes = GetModel(DiagramNoteModel);
  const layouts = GetModel(DiagramLayoutModel);
  for (const schemaName of [SHOP, VAULT, UNKNOWN]) {
    for (const note of await notes.listFor(OWN_CONNECTION, schemaName))
      await notes.delete(note._id);
    for (const row of await layouts.getBy("schemaName", schemaName))
      await layouts.delete(row._id);
  }
}

async function layoutOf(schema: string): Promise<JsonValue> {
  const answer = await call(owner, "GET", `/database/diagram/layout/${schema}`);
  return at(answer.body, "positions");
}

function saveLayout(schema: string, body: JsonObject) {
  return call(
    owner,
    "PUT",
    `/database/diagram/layout/${schema}?connection=own`,
    body,
  );
}

async function notesOf(schema: string): Promise<JsonValue[]> {
  const answer = await call(owner, "GET", `${NOTES}?schema=${schema}`);
  return itemsAt(answer.body, "items");
}

function writeNote(method: string, path: string, body?: JsonObject) {
  return call(owner, method, `${NOTES}${path}?connection=own`, body);
}

function fields(note: JsonValue, names: string[]): JsonValue[] {
  return names.map((name) => at(note, name));
}

async function layoutApi(): Promise<void> {
  assert.deepEqual(await layoutOf(SHOP), {}, "no save reads no position");
  const first = { orders: { x: 10.5, y: -3 }, customers: { x: 400, y: 20 } };
  const put = await saveLayout(SHOP, { positions: first });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { success: true }, "a save answers success");
  assert.deepEqual(
    await layoutOf(SHOP),
    first,
    "a layout stored rounded would not read back exactly",
  );
  const second = { products: { x: 1, y: 2 } };
  const replaced = await saveLayout(SHOP, { positions: second });
  assert.deepEqual(replaced.body, { success: true });
  assert.deepEqual(
    await layoutOf(SHOP),
    second,
    "a save merged into the first would keep orders",
  );
  await saveLayout(VAULT, { positions: { accounts: { x: 7, y: 8 } } });
  assert.deepEqual(await layoutOf(VAULT), { accounts: { x: 7, y: 8 } });
  assert.deepEqual(
    await layoutOf(SHOP),
    second,
    "one layout for every schema would read vault's",
  );
  assert.deepEqual(await layoutOf(UNKNOWN), {}, "an unknown schema is empty");

  const missing = await saveLayout(SHOP, {});
  assert.equal(missing.status, 400, "a body without positions is refused");
  const text = await saveLayout(SHOP, {
    positions: { orders: { x: "a", y: 1 } },
  });
  assert.equal(text.status, 400, "a text coordinate is refused 400");
  assert.ok(text.text.includes("finite"), text.text);
  const missingY = await saveLayout(SHOP, { positions: { orders: { x: 1 } } });
  assert.equal(missingY.status, 400, "a position without y is refused 400");
  assert.deepEqual(
    await layoutOf(SHOP),
    second,
    "a refused save that stored part of its body would change the layout",
  );

  const cleared = await saveLayout(SHOP, { positions: {} });
  assert.equal(cleared.status, 200, "an empty layout is a valid save");
  assert.deepEqual(await layoutOf(SHOP), {});
}

async function notesApi(): Promise<void> {
  const created = await writeNote("POST", "", NOTE);
  const id = textAt(created.body, "id");
  const other = await writeNote("POST", "", {
    schemaName: VAULT,
    x: 1,
    y: 2,
    width: 3,
    height: 4,
  });
  assert.deepEqual(
    fields(created.body, [
      "schemaName",
      "text",
      "x",
      "y",
      "width",
      "height",
      "color",
    ]),
    [SHOP, "reorder", 12.5, -40, 220, 140, null],
    "a note comes back with its fields",
  );
  const createdAt = textAt(created.body, "createdAt");
  assert.ok(id.length > 5, "it has an id");
  assert.ok(!Number.isNaN(Date.parse(createdAt)), "createdAt is a date");
  assert.equal(createdAt, textAt(created.body, "updatedAt"));
  const ids = async (schema: string) =>
    (await notesOf(schema)).map((note) => textAt(note, "id"));
  assert.deepEqual(
    [await ids(SHOP), await ids(VAULT)],
    [[id], [textAt(other.body, "id")]],
    "a list that ignored the schema would hold both notes",
  );

  const updated = await writeNote("PUT", `/${id}`, { text: "done", x: 99 });
  assert.deepEqual(
    fields(updated.body, ["text", "x", "y", "width"]),
    ["done", 99, -40, 220],
    "an update that replaced the note would lose y and width",
  );
  const colored = await writeNote("PUT", `/${id}`, { color: "warning" });
  assert.deepEqual(
    fields(colored.body, ["color", "text"]),
    ["warning", "done"],
    "a color is kept",
  );
  assert.ok(
    Date.parse(textAt(updated.body, "updatedAt")) >= Date.parse(createdAt),
    "an update moves updatedAt forward",
  );
  assert.deepEqual(
    fields((await notesOf(SHOP))[0] ?? null, ["text", "x", "color"]),
    ["done", 99, "warning"],
    "the list reads the update back",
  );

  const removed = await writeNote("DELETE", `/${id}`);
  assert.deepEqual(removed.body, { success: true });
  assert.deepEqual(await ids(SHOP), [], "the deleted note is gone");
  assert.equal(
    (await ids(VAULT)).length,
    1,
    "a delete by schema would remove vault's note",
  );
  const again = await writeNote("DELETE", `/${id}`);
  assert.equal(again.status, 404, "a deleted note cannot be deleted again");
}

async function notesRefusals(): Promise<void> {
  const created = await writeNote("POST", "", NOTE);
  const id = textAt(created.body, "id");
  const noHeight = await writeNote("POST", "", {
    schemaName: SHOP,
    x: 1,
    y: 2,
    width: 3,
  });
  const noSchema = await writeNote("POST", "", {
    x: 1,
    y: 2,
    width: 3,
    height: 4,
  });
  const nanX = await writeNote("PUT", `/${id}`, { x: "far" });
  const unknownPut = await writeNote("PUT", "/nope", { text: "x" });
  const unknownDelete = await writeNote("DELETE", "/nope");
  const withoutSchema = await call(owner, "GET", NOTES);
  const kept = await notesOf(SHOP);
  assert.equal(noHeight.status, 400, "a note without a height is refused");
  assert.equal(noSchema.status, 400, "a note without a schema is refused");
  assert.equal(nanX.status, 400, "a text coordinate is refused 400");
  assert.equal(
    at(kept[0] ?? null, "x"),
    12.5,
    "a refused update that wrote the coordinate would move the note",
  );
  assert.deepEqual(
    [unknownPut.status, unknownDelete.status],
    [404, 404],
    "an unknown note cannot be updated or deleted",
  );
  assert.equal(withoutSchema.status, 400, "listing needs a schema");
  assert.equal(kept.length, 1, "only the one valid note is stored");
}

async function ownerOnly(): Promise<void> {
  const calls: { method: string; path: string; body?: JsonObject }[] = [
    { method: "GET", path: `/database/diagram/layout/${SHOP}` },
    {
      method: "PUT",
      path: `/database/diagram/layout/${SHOP}`,
      body: { positions: {} },
    },
    { method: "GET", path: `${NOTES}?schema=${SHOP}` },
    { method: "POST", path: NOTES, body: NOTE },
    { method: "PUT", path: `${NOTES}/x`, body: { text: "y" } },
    { method: "DELETE", path: `${NOTES}/x` },
  ];
  for (const { method, path, body } of calls) {
    const anonymous = await call(null, method, path, body);
    const reader = await call(member, method, path, body);
    assert.equal(anonymous.status, 401, `${method} ${path} refuses nobody`);
    assert.equal(reader.status, 403, `${method} ${path} refuses a member`);
  }
  assert.deepEqual(
    await notesOf(SHOP),
    [],
    "a refused call that still ran its handler would store a note",
  );
}

describe("[integration] diagram journeys", () => {
  before(async () => {
    owner = await createOwnerSession("diagram-journeys-owner@test.local");
    member = await createMemberSession("diagram-journeys-member@test.local");
  });
  beforeEach(clearAll);
  after(async () => {
    await clearAll();
    await owner.remove();
    await member.remove();
  });

  it(
    "the-layout-api-stores-one-layout-per-schema-and-refuses-bad-positions",
    layoutApi,
  );
  it(
    "the-notes-api-creates-lists-updates-and-deletes-notes-per-schema",
    notesApi,
  );
  it(
    "the-notes-api-refuses-missing-numbers-with-400-and-unknown-notes-with-404",
    notesRefusals,
  );
  it("every-diagram-route-answers-the-platform-owner-only", ownerOnly);
});
