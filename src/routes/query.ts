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
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  QueryHistoryModel,
  type QueryHistoryRow,
  SavedQueryModel,
  type SavedQueryRow,
} from "../db";
import {
  containsMutation,
  describeUnknownTarget,
  type DryRunResult,
  dryRun,
  readQueryTarget,
} from "../service/queryInspection";
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
// Rows a run sends back at most; the console says when it cut the rest.
const MAX_RESULT_ROWS = 1000;
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

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
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
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt ?? row.createdAt),
  };
}

// The names of the users who shared queries, read once per listing.
async function ownerNames(userIds: string[]): Promise<Map<string, string>> {
  const users = GetModel(UserModel);
  const names = new Map<string, string>();
  for (const userId of new Set(userIds)) {
    try {
      const user = await users.get(userId);
      if (user?.name) names.set(userId, user.name);
    } catch {
      // A deleted account leaves its shared queries unnamed.
    }
  }
  return names;
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
  const entry: HistoryEntry = {
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
    // Rows stored before failed runs were recorded only hold successes.
    status: row.status ?? "ok",
    mutation: row.mutation ?? false,
  };
  if (row.error) entry.error = row.error;
  return entry;
}

interface ExecuteBodyParsed {
  query: Record<string, unknown>;
  source: string;
  language: QueryLanguage;
  root: Query<unknown>;
}

function parseExecuteBody(body: ExecuteBody): ExecuteBodyParsed {
  const query = asRecord(body?.query);
  return {
    query,
    source: asNonEmptyString(body?.source),
    language: asLanguage(body?.language),
    root: decodeRunnable(query),
  };
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message || "Query execution failed";
}

@AuthOwnerOnly()
export class DatabaseQueryController extends Controller("/api/database/query") {
  @Post("/execute")
  async execute(
    @AuthRawUser() user: User,
    @JSONBody() body: ExecuteBody,
  ): Promise<ExecuteResult> {
    const { query, source, language, root } = parseExecuteBody(body);
    const mutation = containsMutation(root);
    const historyModel = GetModel(QueryHistoryModel);
    const executedAt = new Date();
    const startedAt = Date.now();
    let raw: unknown;
    try {
      const unknownTarget = describeUnknownTarget(readQueryTarget(root));
      if (unknownTarget) throw new Error(unknownTarget);
      raw = await root.run();
    } catch (error) {
      const message = errorMessage(error);
      await historyModel.addAndPrune({
        userId: user._id,
        query,
        source,
        language,
        executedAt,
        durationMs: Date.now() - startedAt,
        rowCount: 0,
        status: "error",
        mutation,
        error: message,
      });
      assert(false, 400, message);
    }
    const durationMs = Date.now() - startedAt;
    const rows = normaliseRows(raw);

    await historyModel.addAndPrune({
      userId: user._id,
      query,
      source,
      language,
      executedAt,
      durationMs,
      rowCount: rows.length,
      status: "ok",
      mutation,
    });

    return {
      rows: rows.slice(0, MAX_RESULT_ROWS),
      rowCount: rows.length,
      truncated: rows.length > MAX_RESULT_ROWS,
      mutation,
      executedAt: executedAt.toISOString(),
      durationMs,
    };
  }

  /**
   * Measures what a query would change without running it: the console's
   * guard names the operation, its target and the rows it touches.
   */
  @Post("/dry-run")
  async dryRun(
    @AuthRawUser() _user: User,
    @JSONBody() body: ExecuteBody,
  ): Promise<DryRunResult> {
    const root = decodeRunnable(asRecord(body?.query));
    const unknownTarget = describeUnknownTarget(readQueryTarget(root));
    assert(!unknownTarget, 400, unknownTarget ?? "");
    try {
      return await dryRun(root);
    } catch (error) {
      assert(false, 400, errorMessage(error));
    }
  }

  @Post("/saved")
  async createSaved(
    @AuthRawUser() user: User,
    @JSONBody() body: SaveBody,
  ): Promise<SavedQuery> {
    const input = parseSaveBody(body);

    const savedModel = GetModel(SavedQueryModel);
    const now = new Date();
    const ids = await savedModel.insert({
      userId: user._id,
      ...input,
      createdAt: now,
      updatedAt: now,
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
    const updatedAt = new Date();
    await GetModel(SavedQueryModel).update(existing._id, {
      ...input,
      updatedAt,
    });
    // The updated row is fully determined by the existing row plus the
    // validated input — no need to fetch it back. Projected first because
    // spreading the model instance copies own properties only: anything the
    // model exposes through its prototype would be dropped, and toSavedWire
    // would read `undefined` for it.
    return {
      ...toSavedWire(existing),
      ...input,
      updatedAt: updatedAt.toISOString(),
    };
  }

  @Get("/saved")
  async listSaved(
    @AuthRawUser() user: User,
    @Parameter("scope", "query") scope: unknown,
  ): Promise<ListResult<SavedQuery>> {
    const savedModel = GetModel(SavedQueryModel);
    const shared = asSavedScope(scope) === "shared";
    const rows = shared
      ? await savedModel.listShared()
      : await savedModel.listForUser(user._id);
    const names = shared
      ? await ownerNames(rows.map((row) => row.userId))
      : new Map<string, string>();
    return {
      items: rows.map((row) => {
        const wire = toSavedWire(row as SavedQueryRow & { _id: string });
        const ownerName = names.get(row.userId);
        return ownerName ? { ...wire, ownerName } : wire;
      }),
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

  @Delete("/history")
  async clearHistory(@AuthRawUser() user: User): Promise<SuccessResponse> {
    await GetModel(QueryHistoryModel).clearForUser(user._id);
    return { success: true };
  }

  @Get("/history/:id")
  async getHistoryEntry(
    @AuthRawUser() user: User,
    @Parameter("id", "param") id: unknown,
  ): Promise<HistoryEntry> {
    const row = await GetModel(QueryHistoryModel).get(asNonEmptyString(id));
    // Another user's run answers like a missing one.
    assert(
      row !== undefined && row.userId === user._id,
      404,
      "History entry not found",
    );
    return toHistoryWire(row as QueryHistoryRow & { _id: string });
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
