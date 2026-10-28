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
import { DiagramLayoutModel, type DiagramNote, DiagramNoteModel } from "../db";
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
  assert(isFiniteNumber(value), 400, `Expected finite number for ${label}`);
}

interface LayoutResponse {
  positions: Record<string, Position>;
}

function asPositions(
  value: JsonValue | undefined,
): LayoutResponse["positions"] {
  assert(
    value !== undefined && isJsonObjectValue(value),
    400,
    "Expected positions object",
  );
  const out: Record<string, Position> = {};
  for (const [key, raw] of Object.entries(value)) {
    assert(isJsonContainer(raw), 400, `Invalid position for ${key}`);
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

@AuthOwnerOnly()
export class DatabaseDiagramController extends Controller(
  "/api/database/diagram",
) {
  @Get("/layout/:schema")
  async getLayout(
    @AuthRawUser() _user: User,
    @Parameter("schema", "param") schema: unknown,
  ): Promise<LayoutResponse> {
    assertNonEmptyString(schema);
    const layoutModel = GetModel(DiagramLayoutModel);
    const row = await layoutModel.getBySchema(schema);
    if (!row) return { positions: {} };
    try {
      const parsed: JsonValue = JSON.parse(row.positions);
      return { positions: asPositions(parsed) };
    } catch {
      return { positions: {} };
    }
  }

  @Put("/layout/:schema")
  async putLayout(
    @AuthRawUser() _user: User,
    @Parameter("schema", "param") schema: unknown,
    @JSONBody() body: LayoutBody,
  ): Promise<SuccessResponse> {
    assertNonEmptyString(schema);
    const raw = body?.positions;
    assert(isJsonValue(raw), 400, "Expected positions object");
    const positions = asPositions(raw);
    const layoutModel = GetModel(DiagramLayoutModel);
    await layoutModel.upsertForSchema(schema, positions);
    return { success: true };
  }

  @Get("/notes")
  async listNotes(
    @AuthRawUser() _user: User,
    @Parameter("schema", "query") schema: unknown,
  ): Promise<ListResult<NoteWire>> {
    assertNonEmptyString(schema);
    const noteModel = GetModel(DiagramNoteModel);
    const rows = await noteModel.listBySchema(schema);
    return {
      items: rows.map((r) => toNoteWire(r)),
    };
  }

  @Post("/notes")
  async createNote(
    @AuthRawUser() _user: User,
    @JSONBody() body: NoteCreateBody,
  ): Promise<NoteWire> {
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
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: unknown,
    @JSONBody() body: NoteUpdateBody,
  ): Promise<NoteWire> {
    assertNonEmptyString(id);
    const noteModel = GetModel(DiagramNoteModel);
    const existing = await noteModel.get(id);
    assert(existing !== undefined, 404, "Note not found");

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
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: unknown,
  ): Promise<SuccessResponse> {
    assertNonEmptyString(id);
    const noteModel = GetModel(DiagramNoteModel);
    const existing = await noteModel.get(id);
    assert(existing !== undefined, 404, "Note not found");
    await noteModel.delete(id);
    return { success: true };
  }
}
