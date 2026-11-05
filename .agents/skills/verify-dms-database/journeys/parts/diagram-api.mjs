import { check, db, member, pick, text } from "../../database.mjs";
import { savedLayout, savedNotes } from "./diagram-page.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} JourneyDef */

const NOTE = { schemaName: "shop", text: "reorder", x: 12.5, y: -40, width: 220, height: 140 };

/** @type {JourneyDef} */
export const layoutApi = {
  id: "the-layout-api-stores-one-layout-per-schema-and-refuses-bad-positions",
  title: "a schema's layout is stored with PUT and read back with GET exactly, an unknown schema reads empty, a second PUT replaces the first, layouts of two schemas stay apart, and positions that are not finite numbers are refused 400",
  entryPoint: "GET/PUT /api/database/diagram/layout/:schema",
  async run(ctx) {
    const empty = await savedLayout(ctx, "shop", "read the layout before any save");
    const put = await db(ctx, "save the shop layout", "PUT", "/diagram/layout/shop", { body: { positions: { orders: { x: 10.5, y: -3 }, customers: { x: 400, y: 20 } } } });
    const first = await savedLayout(ctx, "shop");
    const replaced = await db(ctx, "save another shop layout", "PUT", "/diagram/layout/shop", { body: { positions: { products: { x: 1, y: 2 } } } });
    const second = await savedLayout(ctx, "shop");
    await db(ctx, "save the vault layout", "PUT", "/diagram/layout/vault", { body: { positions: { accounts: { x: 7, y: 8 } } } });
    const vault = await savedLayout(ctx, "vault");
    const shopAgain = await savedLayout(ctx, "shop");
    const unknown = await savedLayout(ctx, "no-such-schema", "read the layout of an unknown schema");
    const missing = await db(ctx, "save without positions", "PUT", "/diagram/layout/shop", { body: {} });
    const text1 = await db(ctx, "save a text position", "PUT", "/diagram/layout/shop", { body: { positions: { orders: { x: "a", y: 1 } } } });
    const missingY = await db(ctx, "save a position without y", "PUT", "/diagram/layout/shop", { body: { positions: { orders: { x: 1 } } } });
    const afterRefusals = await savedLayout(ctx, "shop", "read the layout after the refusals");
    const cleared = await db(ctx, "save an empty layout", "PUT", "/diagram/layout/shop", { body: { positions: {} } });
    const none = await savedLayout(ctx, "shop", "read the emptied layout");
    await ctx.verify("the layout routes", [
      check("a schema without a save reads no position", Object.keys(empty).length === 0, empty),
      check("a save answers success", pick(put.body, "success") === true && put.status === 200, put),
      check("the layout reads back exactly", JSON.stringify(first) === JSON.stringify({ orders: { x: 10.5, y: -3 }, customers: { x: 400, y: 20 } }), first),
      check("a second save replaces the first", pick(replaced.body, "success") === true && JSON.stringify(second) === JSON.stringify({ products: { x: 1, y: 2 } }), second),
      check("each schema keeps its own layout", JSON.stringify(vault) === JSON.stringify({ accounts: { x: 7, y: 8 } }) && JSON.stringify(shopAgain) === JSON.stringify(second), [vault, shopAgain]),
      check("an unknown schema reads empty", Object.keys(unknown).length === 0, unknown),
      check("a body without positions is refused 400", missing.status === 400, missing),
      check("a text coordinate is refused 400", text1.status === 400 && text(text1.body).includes("finite"), text1),
      check("a position without y is refused 400", missingY.status === 400, missingY),
      check("a refused save changes nothing", JSON.stringify(afterRefusals) === JSON.stringify(second), afterRefusals),
      check("an empty layout is a valid save", cleared.status === 200 && Object.keys(none).length === 0, none),
    ]);
  },
};

/** @type {JourneyDef} */
export const notesApi = {
  id: "the-notes-api-creates-lists-updates-and-deletes-notes-per-schema",
  title: "notes are created with a position and size, listed by schema, updated in part and deleted, each schema keeping its own",
  entryPoint: "GET/POST /api/database/diagram/notes, PUT/DELETE /notes/:id",
  async run(ctx) {
    const created = await db(ctx, "create a note", "POST", "/diagram/notes", { body: NOTE });
    const id = text(created.body, "id");
    const other = await db(ctx, "create a vault note", "POST", "/diagram/notes", { body: { schemaName: "vault", x: 1, y: 2, width: 3, height: 4 } });
    const shopNotes = await savedNotes(ctx, "shop");
    const vaultNotes = await savedNotes(ctx, "vault");
    const updated = await db(ctx, "move and write the note", "PUT", `/diagram/notes/${id}`, { body: { text: "done", x: 99 } });
    const colored = await db(ctx, "color the note", "PUT", `/diagram/notes/${id}`, { body: { color: "warning" } });
    const reread = await savedNotes(ctx, "shop");
    const removed = await db(ctx, "delete the note", "DELETE", `/diagram/notes/${id}`);
    const afterDelete = await savedNotes(ctx, "shop");
    const vaultStill = await savedNotes(ctx, "vault");
    const note = shopNotes[0];
    await ctx.verify("the notes routes", [
      check("a note comes back with its fields", pick(created.body, "schemaName") === "shop" && pick(created.body, "text") === "reorder" && pick(created.body, "x") === 12.5 && pick(created.body, "y") === -40 && pick(created.body, "width") === 220 && pick(created.body, "height") === 140 && pick(created.body, "color") === null, created.body),
      check("it has an id and ISO dates", id.length > 5 && !Number.isNaN(Date.parse(text(created.body, "createdAt"))) && text(created.body, "createdAt") === text(created.body, "updatedAt"), created.body),
      check("a schema lists its own notes only", shopNotes.length === 1 && text(note, "id") === id && vaultNotes.length === 1 && text(vaultNotes[0], "id") === text(other.body, "id"), [shopNotes, vaultNotes]),
      check("an update changes the sent fields only", pick(updated.body, "text") === "done" && pick(updated.body, "x") === 99 && pick(updated.body, "y") === -40 && pick(updated.body, "width") === 220, updated.body),
      check("a color is kept", pick(colored.body, "color") === "warning" && pick(colored.body, "text") === "done", colored.body),
      check("an update moves updatedAt forward", Date.parse(text(updated.body, "updatedAt")) >= Date.parse(text(created.body, "updatedAt")), updated.body),
      check("the list reads the update back", text(reread[0], "text") === "done" && pick(reread[0], "x") === 99 && pick(reread[0], "color") === "warning", reread),
      check("a delete answers success and removes only that note", pick(removed.body, "success") === true && afterDelete.length === 0 && vaultStill.length === 1, [afterDelete, vaultStill]),
      check("a deleted note cannot be deleted again", (await db(ctx, "delete it again", "DELETE", `/diagram/notes/${id}`)).status === 404, id),
    ]);
  },
};

/** @type {JourneyDef} */
export const ownerOnly = {
  id: "every-diagram-route-answers-the-platform-owner-only",
  title: "the layout and notes routes refuse a request without a session 401 and a member who is not the platform owner 403, for reading and writing",
  entryPoint: "/api/database/diagram/**",
  async run(ctx) {
    await member(ctx, "reader", []);
    /** @type {{ method: string, path: string, body?: unknown }[]} */
    const calls = [
      { method: "GET", path: "/diagram/layout/shop" },
      { method: "PUT", path: "/diagram/layout/shop", body: { positions: {} } },
      { method: "GET", path: "/diagram/notes?schema=shop" },
      { method: "POST", path: "/diagram/notes", body: NOTE },
      { method: "PUT", path: "/diagram/notes/x", body: { text: "y" } },
      { method: "DELETE", path: "/diagram/notes/x" },
    ];
    const checks = [];
    for (const { method, path, body } of calls) {
      const anon = await db(ctx, `${method} ${path} without a session`, method, path, { as: "anon", body });
      const reader = await db(ctx, `${method} ${path} as a member`, method, path, { as: "reader", body });
      checks.push(check(`${method} ${path} refuses nobody 401`, anon.status === 401, anon.status), check(`${method} ${path} refuses a member 403`, reader.status === 403, reader.status));
    }
    const stored = await savedNotes(ctx, "shop");
    checks.push(check("the refused calls stored nothing", stored.length === 0, stored));
    await ctx.verify("who may use the diagram routes", checks);
  },
};

/** @type {JourneyDef} */
export const notesRefusals = {
  id: "the-notes-api-refuses-missing-numbers-with-400-and-unknown-notes-with-404",
  title: "a note without a schema, width or height, or with a coordinate that is not a number, is refused 400, listing needs a schema, and updating or deleting an unknown note is refused 404 and stores nothing",
  entryPoint: "POST/PUT/DELETE /api/database/diagram/notes",
  async run(ctx) {
    const created = await db(ctx, "create a note", "POST", "/diagram/notes", { body: NOTE });
    const id = text(created.body, "id");
    const noHeight = await db(ctx, "create a note without height", "POST", "/diagram/notes", { body: { schemaName: "shop", x: 1, y: 2, width: 3 } });
    const noSchema = await db(ctx, "create a note without schema", "POST", "/diagram/notes", { body: { x: 1, y: 2, width: 3, height: 4 } });
    const nanX = await db(ctx, "update with a text coordinate", "PUT", `/diagram/notes/${id}`, { body: { x: "far" } });
    const unknownPut = await db(ctx, "update an unknown note", "PUT", "/diagram/notes/nope", { body: { text: "x" } });
    const unknownDelete = await db(ctx, "delete an unknown note", "DELETE", "/diagram/notes/nope");
    const withoutSchema = await db(ctx, "list without a schema", "GET", "/diagram/notes");
    const kept = await savedNotes(ctx, "shop");
    await ctx.verify("the notes refusals", [
      check("a note without a height is refused 400", noHeight.status === 400, noHeight),
      check("a note without a schema is refused 400", noSchema.status === 400, noSchema),
      check("a text coordinate is refused 400 and changes nothing", nanX.status === 400 && pick(kept[0], "x") === 12.5, [nanX, kept]),
      check("an unknown note cannot be updated or deleted", unknownPut.status === 404 && unknownDelete.status === 404, [unknownPut.status, unknownDelete.status]),
      check("listing needs a schema", withoutSchema.status === 400, withoutSchema),
      check("only the one valid note is stored", kept.length === 1, kept),
    ]);
  },
};
