import {
  Controller,
  Delete,
  Get,
  JSONBody,
  Parameter,
  Post,
  Put,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  DiagramLayoutModel,
  type DiagramNote,
  DiagramNoteModel,
  noteConnection,
} from "../db";
import { REFUSALS, refusal, refuse } from "../service/refusals";
import { resolveSelectedDatabase } from "../service/connectionState";
import {
  isJsonContainer,
  isJsonObjectValue,
  isJsonValue,
  type JsonObject,
  type JsonValue,
} from "../types/json";
import type { ListResult, Position, SuccessResponse } from "../types/responses";
import { isFiniteNumber, isString } from "../utils/guards";
import { assertNonEmptyString } from "../utils/requestValidation";

interface LayoutBody {
  positions?: unknown;
}

interface NoteCreateBody {
  schemaName?: unknown;
  text?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  color?: unknown;
}

interface NoteUpdateBody {
  text?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  color?: unknown;
}

interface NoteWire {
  id: string;
  schemaName: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

function assertFiniteNumber(
  value: unknown,
  label: string,
): asserts value is number {
  refuse(isFiniteNumber(value), REFUSALS.invalidNumber, { field: label });
}

interface LayoutResponse {
  positions: Record<string, Position>;
}

function asPositions(
  value: JsonValue | undefined,
): LayoutResponse["positions"] {
  refuse(value !== undefined && isJsonObjectValue(value), REFUSALS.layoutBody);
  const out: Record<string, Position> = {};
  for (const [key, raw] of Object.entries(value)) {
    refuse(isJsonContainer(raw), REFUSALS.invalidPosition, { table: key });
    const entry: JsonObject = isJsonObjectValue(raw) ? raw : {};
    assertFiniteNumber(entry.x, `${key}.x`);
    assertFiniteNumber(entry.y, `${key}.y`);
    out[key] = { x: entry.x, y: entry.y };
  }
  return out;
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toNoteWire(row: DiagramNote): NoteWire {
  return {
    id: row._id,
    schemaName: row.schemaName,
    text: row.text,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    color: row.color ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** The connection of the database the user browses, whose diagram a request reads. */
async function selectedConnection(user: User): Promise<string> {
  return (await resolveSelectedDatabase(user._id)).connection;
}

/**
 * The connection a write is for: the one the page loaded with, refused once
 * another tab switched the user's database, so a stale page never writes its
 * layout or its notes into another database's diagram.
 */
async function writtenConnection(user: User, asked: string): Promise<string> {
  const connection = await selectedConnection(user);
  if (asked !== connection) {
    throw refusal(REFUSALS.staleDatabase);
  }
  return connection;
}

/**
 * A note of the database the user browses: a note of another database is
 * not found here.
 */
async function noteOf(connection: string, id: string): Promise<DiagramNote> {
  const note = await GetModel(DiagramNoteModel).get(id);
  refuse(
    note !== undefined && noteConnection(note) === connection,
    REFUSALS.noteNotFound,
  );
  return note;
}

@AuthOwnerOnly()
export class DatabaseDiagramController extends Controller(
  "/api/database/diagram",
) {
  @Get("/layout/:schema")
  async getLayout(
    @AuthRawUser() user: User,
    @Parameter("schema", "param") schema: unknown,
  ): Promise<LayoutResponse> {
    const connection = await selectedConnection(user);
    assertNonEmptyString(schema);
    const layoutModel = GetModel(DiagramLayoutModel);
    const row = await layoutModel.getFor(connection, schema);
    if (!row) return { positions: {} };
    try {
      const parsed: unknown = JSON.parse(row.positions);
      return {
        positions: asPositions(isJsonValue(parsed) ? parsed : undefined),
      };
    } catch {
      return { positions: {} };
    }
  }

  @Put("/layout/:schema")
  async putLayout(
    @AuthRawUser() user: User,
    @Parameter("connection", "query") asked: unknown,
    @Parameter("schema", "param") schema: unknown,
    @JSONBody() body: LayoutBody,
  ): Promise<SuccessResponse> {
    assertNonEmptyString(asked);
    const connection = await writtenConnection(user, asked);
    assertNonEmptyString(schema);
    const raw = body?.positions;
    refuse(isJsonValue(raw), REFUSALS.layoutBody);
    const positions = asPositions(raw);
    const layoutModel = GetModel(DiagramLayoutModel);
    await layoutModel.upsertFor(connection, schema, positions);
    return { success: true };
  }

  @Get("/notes")
  async listNotes(
    @AuthRawUser() user: User,
    @Parameter("schema", "query") schema: unknown,
  ): Promise<ListResult<NoteWire>> {
    const connection = await selectedConnection(user);
    assertNonEmptyString(schema);
    const noteModel = GetModel(DiagramNoteModel);
    const rows = await noteModel.listFor(connection, schema);
    return {
      items: rows.map((r) => toNoteWire(r)),
    };
  }

  @Post("/notes")
  async createNote(
    @AuthRawUser() user: User,
    @Parameter("connection", "query") asked: unknown,
    @JSONBody() body: NoteCreateBody,
  ): Promise<NoteWire> {
    assertNonEmptyString(asked);
    const connection = await writtenConnection(user, asked);
    const schemaName = body?.schemaName;
    assertNonEmptyString(schemaName);
    const rawText = body?.text;
    const text = isString(rawText) ? rawText : "";
    const x = body?.x;
    assertFiniteNumber(x, "x");
    const y = body?.y;
    assertFiniteNumber(y, "y");
    const width = body?.width;
    assertFiniteNumber(width, "width");
    const height = body?.height;
    assertFiniteNumber(height, "height");
    const rawColor = body?.color;
    const color = isString(rawColor) ? rawColor : undefined;

    const noteModel = GetModel(DiagramNoteModel);
    const now = new Date();
    const ids = await noteModel.insert({
      schemaName,
      connection,
      text,
      x,
      y,
      width,
      height,
      color,
      createdAt: now,
      updatedAt: now,
    });
    const id = ids[0];
    assert(id !== undefined, 500, "Failed to persist note");
    const row = await noteModel.get(id);
    assert(row !== undefined, 500, "Failed to load note after insert");
    return toNoteWire(row);
  }

  @Put("/notes/:id")
  async updateNote(
    @AuthRawUser() user: User,
    @Parameter("connection", "query") asked: unknown,
    @Parameter("id", "param") id: unknown,
    @JSONBody() body: NoteUpdateBody,
  ): Promise<NoteWire> {
    assertNonEmptyString(asked);
    const connection = await writtenConnection(user, asked);
    assertNonEmptyString(id);
    await noteOf(connection, id);
    const noteModel = GetModel(DiagramNoteModel);

    const patch: Partial<DiagramNote> = { updatedAt: new Date() };
    const { text, x, y, width, height, color }: NoteUpdateBody = body ?? {};
    if (text !== undefined) patch.text = isString(text) ? text : "";
    if (x !== undefined) {
      assertFiniteNumber(x, "x");
      patch.x = x;
    }
    if (y !== undefined) {
      assertFiniteNumber(y, "y");
      patch.y = y;
    }
    if (width !== undefined) {
      assertFiniteNumber(width, "width");
      patch.width = width;
    }
    if (height !== undefined) {
      assertFiniteNumber(height, "height");
      patch.height = height;
    }
    if (color !== undefined) patch.color = isString(color) ? color : undefined;

    await noteModel.update(id, patch);
    const row = await noteModel.get(id);
    assert(row !== undefined, 500, "Failed to reload note after update");
    return toNoteWire(row);
  }

  @Delete("/notes/:id")
  async deleteNote(
    @AuthRawUser() user: User,
    @Parameter("connection", "query") asked: unknown,
    @Parameter("id", "param") id: unknown,
  ): Promise<SuccessResponse> {
    assertNonEmptyString(asked);
    const connection = await writtenConnection(user, asked);
    assertNonEmptyString(id);
    await noteOf(connection, id);
    await GetModel(DiagramNoteModel).delete(id);
    return { success: true };
  }
}
