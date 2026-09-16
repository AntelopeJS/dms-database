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
import type { ListResult, Position, SuccessResponse } from "../types/responses";
import { asNonEmptyString, asString } from "../utils/requestValidation";

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

function asFiniteNumber(value: unknown, label: string): number {
  assert(
    typeof value === "number" && Number.isFinite(value),
    400,
    `Expected finite number for ${label}`,
  );
  return value as number;
}

interface LayoutResponse {
  positions: Record<string, Position>;
}

function asPositions(value: unknown): Record<string, Position> {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    400,
    "Expected positions object",
  );
  const out: Record<string, Position> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    assert(
      typeof raw === "object" && raw !== null,
      400,
      `Invalid position for ${key}`,
    );
    const entry = raw as { x?: unknown; y?: unknown };
    const x = asFiniteNumber(entry.x, `${key}.x`);
    const y = asFiniteNumber(entry.y, `${key}.y`);
    out[key] = { x, y };
  }
  return out;
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toNoteWire(row: DiagramNote & { _id: string }): NoteWire {
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
    const schemaName = asNonEmptyString(schema);
    const layoutModel = GetModel(DiagramLayoutModel);
    const row = await layoutModel.getBySchema(schemaName);
    if (!row) return { positions: {} };
    try {
      const parsed = JSON.parse(row.positions);
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
    const schemaName = asNonEmptyString(schema);
    const positions = asPositions(body?.positions);
    const layoutModel = GetModel(DiagramLayoutModel);
    await layoutModel.upsertForSchema(schemaName, positions);
    return { success: true };
  }

  @Get("/notes")
  async listNotes(
    @AuthRawUser() _user: User,
    @Parameter("schema", "query") schema: unknown,
  ): Promise<ListResult<NoteWire>> {
    const schemaName = asNonEmptyString(schema);
    const noteModel = GetModel(DiagramNoteModel);
    const rows = await noteModel.listBySchema(schemaName);
    return {
      items: rows.map((r) => toNoteWire(r as DiagramNote & { _id: string })),
    };
  }

  @Post("/notes")
  async createNote(
    @AuthRawUser() _user: User,
    @JSONBody() body: NoteCreateBody,
  ): Promise<NoteWire> {
    const schemaName = asNonEmptyString(body?.schemaName);
    const text = asString(body?.text) ?? "";
    const x = asFiniteNumber(body?.x, "x");
    const y = asFiniteNumber(body?.y, "y");
    const width = asFiniteNumber(body?.width, "width");
    const height = asFiniteNumber(body?.height, "height");
    const color = asString(body?.color);

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
    return toNoteWire(row as DiagramNote & { _id: string });
  }

  @Put("/notes/:id")
  async updateNote(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: unknown,
    @JSONBody() body: NoteUpdateBody,
  ): Promise<NoteWire> {
    const noteId = asNonEmptyString(id);
    const noteModel = GetModel(DiagramNoteModel);
    const existing = await noteModel.get(noteId);
    assert(existing !== undefined, 404, "Note not found");

    const patch: Partial<DiagramNote> = { updatedAt: new Date() };
    if (body?.text !== undefined) patch.text = asString(body.text) ?? "";
    if (body?.x !== undefined) patch.x = asFiniteNumber(body.x, "x");
    if (body?.y !== undefined) patch.y = asFiniteNumber(body.y, "y");
    if (body?.width !== undefined)
      patch.width = asFiniteNumber(body.width, "width");
    if (body?.height !== undefined)
      patch.height = asFiniteNumber(body.height, "height");
    if (body?.color !== undefined) patch.color = asString(body.color);

    await noteModel.update(noteId, patch);
    const row = await noteModel.get(noteId);
    assert(row !== undefined, 500, "Failed to reload note after update");
    return toNoteWire(row as DiagramNote & { _id: string });
  }

  @Delete("/notes/:id")
  async deleteNote(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: unknown,
  ): Promise<SuccessResponse> {
    const noteId = asNonEmptyString(id);
    const noteModel = GetModel(DiagramNoteModel);
    const existing = await noteModel.get(noteId);
    assert(existing !== undefined, 404, "Note not found");
    await noteModel.delete(noteId);
    return { success: true };
  }
}
