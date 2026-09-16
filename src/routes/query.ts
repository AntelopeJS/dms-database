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
import { Query } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  QueryHistoryModel,
  type QueryHistoryRow,
  SavedQueryModel,
  type SavedQueryRow,
} from "../db";
import { decodeStaged } from "../service/stagedSerialization";
import type {
  ExecuteResult,
  HistoryEntry,
  QueryLanguage,
  SavedQuery,
} from "../service/types";
import type {
  ListResult,
  PaginatedResult,
  SuccessResponse,
} from "../types/responses";
import { clamp, parseInteger } from "../utils/query";
import { asNonEmptyString, asString } from "../utils/requestValidation";

const DEFAULT_HISTORY_LIMIT = 25;
const MAX_HISTORY_LIMIT = 200;
const SUPPORTED_LANGUAGES: QueryLanguage[] = ["aql"];

type SavedScope = "me" | "shared";

interface ExecuteBody {
  query?: unknown;
  source?: unknown;
  language?: unknown;
}

interface SaveBody {
  name?: unknown;
  description?: unknown;
  query?: unknown;
  source?: unknown;
  language?: unknown;
  shared?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    400,
    "Expected query to be an object",
  );
  return value as Record<string, unknown>;
}

function asLanguage(value: unknown): QueryLanguage {
  const lang = asString(value);
  assert(
    lang !== undefined && SUPPORTED_LANGUAGES.includes(lang as QueryLanguage),
    400,
    "Unsupported query language",
  );
  return lang as QueryLanguage;
}

function asSavedScope(value: unknown): SavedScope {
  const str = asString(value);
  if (str === "shared") return "shared";
  return "me";
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function decodeRunnable(query: Record<string, unknown>): Query<unknown> {
  const root = decodeStaged(query);
  assert(
    root instanceof Query,
    400,
    "Query must resolve to a runnable expression (Table/Selection/Stream/Datum/Query)",
  );
  return root as Query<unknown>;
}

interface ParsedSaveBody {
  name: string;
  description: string;
  query: Record<string, unknown>;
  source: string;
  language: QueryLanguage;
  shared: boolean;
}

// Shared create/update payload validation, including the runnable check.
function parseSaveBody(body: SaveBody): ParsedSaveBody {
  const query = asRecord(body?.query);
  decodeRunnable(query);
  return {
    name: asNonEmptyString(body?.name),
    description: asString(body?.description) ?? "",
    query,
    source: asNonEmptyString(body?.source),
    language: asLanguage(body?.language),
    shared: asBoolean(body?.shared),
  };
}

// Loads a saved query for a mutating route; non-owners get the same 404 as
// a missing id so the route does not leak other users' query ids.
async function getOwnedSavedQuery(
  id: unknown,
  userId: string,
): Promise<SavedQueryRow & { _id: string }> {
  const queryId = asNonEmptyString(id);
  const row = await GetModel(SavedQueryModel).get(queryId);
  assert(row !== undefined, 404, "Saved query not found");
  const owned = row as SavedQueryRow & { _id: string };
  assert(owned.userId === userId, 404, "Saved query not found");
  return owned;
}

function toSavedWire(row: SavedQueryRow & { _id: string }): SavedQuery {
  return {
    id: row._id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    query: row.query,
    source: row.source,
    language: row.language,
    shared: row.shared,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString(),
  };
}

function normaliseRows(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.map((entry) =>
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : { value: entry },
    );
  }
  if (raw === undefined) return [];
  if (raw !== null && typeof raw === "object") {
    return [raw as Record<string, unknown>];
  }
  return [{ value: raw }];
}

function toHistoryWire(row: QueryHistoryRow & { _id: string }): HistoryEntry {
  return {
    id: row._id,
    userId: row.userId,
    query: row.query,
    source: row.source,
    language: row.language,
    executedAt:
      row.executedAt instanceof Date
        ? row.executedAt.toISOString()
        : new Date(row.executedAt).toISOString(),
    durationMs: row.durationMs,
    rowCount: row.rowCount,
  };
}

@AuthOwnerOnly()
export class DatabaseQueryController extends Controller("/api/database/query") {
  @Post("/execute")
  async execute(
    @AuthRawUser() user: User,
    @JSONBody() body: ExecuteBody,
  ): Promise<ExecuteResult> {
    const query = asRecord(body?.query);
    const source = asNonEmptyString(body?.source);
    const language = asLanguage(body?.language);
    const root = decodeRunnable(query);

    const executedAt = new Date();
    const startedAt = Date.now();
    let raw: unknown;
    try {
      raw = await root.run();
    } catch (err) {
      assert(false, 400, (err as Error).message ?? "Query execution failed");
    }
    const durationMs = Date.now() - startedAt;
    const rows = normaliseRows(raw);

    const historyModel = GetModel(QueryHistoryModel);
    await historyModel.addAndPrune({
      userId: user._id,
      query,
      source,
      language,
      executedAt,
      durationMs,
      rowCount: rows.length,
    });

    return {
      rows,
      executedAt: executedAt.toISOString(),
      durationMs,
    };
  }

  @Post("/saved")
  async createSaved(
    @AuthRawUser() user: User,
    @JSONBody() body: SaveBody,
  ): Promise<SavedQuery> {
    const input = parseSaveBody(body);

    const savedModel = GetModel(SavedQueryModel);
    const ids = await savedModel.insert({
      userId: user._id,
      ...input,
      createdAt: new Date(),
    });
    const id = ids[0];
    assert(id !== undefined, 500, "Failed to persist saved query");
    const row = await savedModel.get(id);
    assert(row !== undefined, 500, "Failed to load saved query after insert");
    return toSavedWire(row as SavedQueryRow & { _id: string });
  }

  @Put("/saved/:id")
  async updateSaved(
    @AuthRawUser() user: User,
    @Parameter("id", "param") id: unknown,
    @JSONBody() body: SaveBody,
  ): Promise<SavedQuery> {
    const input = parseSaveBody(body);
    const existing = await getOwnedSavedQuery(id, user._id);
    await GetModel(SavedQueryModel).update(existing._id, input);
    // The updated row is fully determined by the existing row plus the
    // validated input — no need to fetch it back. Projected first because
    // spreading the model instance copies own properties only: anything the
    // model exposes through its prototype would be dropped, and toSavedWire
    // would read `undefined` for it.
    return { ...toSavedWire(existing), ...input };
  }

  @Get("/saved")
  async listSaved(
    @AuthRawUser() user: User,
    @Parameter("scope", "query") scope: unknown,
  ): Promise<ListResult<SavedQuery>> {
    const savedModel = GetModel(SavedQueryModel);
    const rows =
      asSavedScope(scope) === "shared"
        ? await savedModel.listShared()
        : await savedModel.listForUser(user._id);
    return {
      items: rows.map((r) => toSavedWire(r as SavedQueryRow & { _id: string })),
    };
  }

  @Delete("/saved/:id")
  async deleteSaved(
    @AuthRawUser() user: User,
    @Parameter("id", "param") id: unknown,
  ): Promise<SuccessResponse> {
    const existing = await getOwnedSavedQuery(id, user._id);
    await GetModel(SavedQueryModel).delete(existing._id);
    return { success: true };
  }

  @Get("/history")
  async listHistory(
    @AuthRawUser() user: User,
    @Parameter("limit", "query") limitRaw: unknown,
    @Parameter("offset", "query") offsetRaw: unknown,
  ): Promise<PaginatedResult<HistoryEntry>> {
    const limit = clamp(
      parseInteger(limitRaw, DEFAULT_HISTORY_LIMIT),
      1,
      MAX_HISTORY_LIMIT,
    );
    const offset = Math.max(0, parseInteger(offsetRaw, 0));

    const historyModel = GetModel(QueryHistoryModel);
    const { items, total } = await historyModel.listForUser(
      user._id,
      limit,
      offset,
    );
    return {
      items: items.map((r) =>
        toHistoryWire(r as QueryHistoryRow & { _id: string }),
      ),
      total,
    };
  }
}
