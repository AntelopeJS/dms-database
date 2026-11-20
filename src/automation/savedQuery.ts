import type { Query } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  ActionType,
  ExecutionCtx,
} from "@antelopejs/interface-dms-automation";
import { SavedQueryModel, type SavedQueryRow } from "../db";
import { untaggedRow } from "../service/jsonRows";
import {
  affectedRows,
  containsMutation,
  describeUnknownQueryTarget,
  dryRun,
  operationOf,
  type QueryOperation,
  readQueryTarget,
} from "../service/queryInspection";
import {
  decodeRunnable,
  normaliseRows,
  type QueryAnswer,
  runQuery,
} from "../service/queryRun";
import type { JsonObject } from "../types/json";
import { isFiniteNumber } from "../utils/guards";
import { asStep } from "./errors";
import {
  booleanInput,
  integerInput,
  stringInput,
  type NodeInput,
} from "./inputs";
import { runAsProcedureWrite } from "./origin";

const MAX_QUERY_ID_LENGTH = 64;
const DEFAULT_MAX_ROWS = 100;
const MAX_ROWS = 1000;

type SavedQueryOutput = {
  queryName: string;
  operation: QueryOperation;
  mutation: boolean;
  simulated: boolean;
  rows: JsonObject[];
  rowCount: number | null;
  truncated: boolean;
  durationMs: number;
};

interface PreparedQuery {
  name: string;
  root: Query<unknown>;
  mutation: boolean;
  operation: QueryOperation;
  maxRows: number;
}

interface SavedQueryRequest {
  name: string;
  query: SavedQueryRow["query"];
  allowWrite: boolean;
  maxRows: number;
}

/** Reads the action's input and loads the saved query it names. */
async function loadSaved(input: NodeInput): Promise<SavedQueryRequest> {
  const queryId = stringInput(input, "queryId", {
    max: MAX_QUERY_ID_LENGTH,
    required: true,
  });
  const allowWrite = booleanInput(input, "allowWrite", false);
  const maxRows = integerInput(input, "maxRows", {
    fallback: DEFAULT_MAX_ROWS,
    min: 1,
    max: MAX_ROWS,
  });
  const saved = await GetModel(SavedQueryModel).get(queryId);
  if (!saved) throw new Error(`Saved query "${queryId}" not found`);
  return { name: saved.name, query: saved.query, allowWrite, maxRows };
}

/** Decodes a saved query; a query that writes needs `allowWrite`. */
function decodeSaved(request: SavedQueryRequest): PreparedQuery {
  const root = decodeRunnable(request.query);
  const mutation = containsMutation(root);
  if (mutation && !request.allowWrite) {
    throw new Error(
      `Saved query "${request.name}" writes: turn on Allow write to run it`,
    );
  }
  return {
    name: request.name,
    root,
    mutation,
    operation: operationOf(root),
    maxRows: request.maxRows,
  };
}

/** Refuses a query that points at an unknown schema, table or instance. */
async function assertKnownTarget(query: PreparedQuery): Promise<void> {
  const unknownTarget = await describeUnknownQueryTarget(
    readQueryTarget(query.root),
  );
  if (unknownTarget) throw new Error(unknownTarget);
}

/** Rows a write's answer says it changed: a count, or the keys it inserted. */
function changedRows(raw: QueryAnswer): number | undefined {
  if (isFiniteNumber(raw)) return raw;
  return Array.isArray(raw) ? raw.length : undefined;
}

async function run(
  query: PreparedQuery,
  ctx: ExecutionCtx,
): Promise<SavedQueryOutput> {
  const startedAt = Date.now();
  const answer = query.mutation
    ? await runAsProcedureWrite(
        { procedureId: ctx.procedureId, runId: ctx.runId },
        readQueryTarget(query.root),
        () => runQuery(query.root, true, query.maxRows),
        ({ raw }) => changedRows(raw),
      )
    : await runQuery(query.root, false, query.maxRows);
  const durationMs = Date.now() - startedAt;
  const rows = normaliseRows(answer.raw).map(
    (row) => untaggedRow(row).row ?? {},
  );
  return {
    queryName: query.name,
    operation: query.operation,
    mutation: query.mutation,
    simulated: false,
    rows: rows.slice(0, query.maxRows),
    rowCount: affectedRows(
      isFiniteNumber(answer.raw) ? answer.raw : undefined,
      answer.total ?? rows.length,
      query.mutation,
    ),
    truncated: rows.length > query.maxRows,
    durationMs,
  };
}

export const runSavedQueryAction: ActionType<NodeInput, SavedQueryOutput> = {
  id: "database.run-saved-query",
  name: "Run saved query",
  description:
    "Runs a query saved in the database console on the project's database. A query that writes runs only when allowed; a test run measures a write without making it",
  icon: "i-ph-play-circle",
  inputSchema: {
    type: "object",
    properties: {
      queryId: {
        type: "string",
        title: "Saved query",
        description: "Id of a query saved in the database console",
        minLength: 1,
        maxLength: MAX_QUERY_ID_LENGTH,
      },
      allowWrite: {
        type: "boolean",
        title: "Allow write",
        description:
          "Lets a query that inserts, updates, replaces or deletes run; without it such a query fails the step",
        default: false,
      },
      maxRows: {
        type: "integer",
        title: "Max rows",
        description: "Rows returned at most, 1 to 1000",
        default: DEFAULT_MAX_ROWS,
        minimum: 1,
        maximum: MAX_ROWS,
      },
    },
    required: ["queryId"],
  },
  outputSchema: {
    type: "object",
    properties: {
      queryName: { type: "string" },
      operation: {
        type: "string",
        enum: ["read", "insert", "update", "replace", "delete"],
      },
      mutation: { type: "boolean", description: "Whether the query writes" },
      simulated: {
        type: "boolean",
        description:
          "True when a test run measured a write instead of running it",
      },
      rows: {
        type: "array",
        items: { type: "object" },
        description: "Answered rows as JSON; empty when simulated",
      },
      rowCount: {
        type: ["number", "null"],
        description:
          "Rows read, or rows changed; when simulated, rows the write would touch (null when unmeasurable)",
      },
      truncated: { type: "boolean", description: "More rows than Max rows" },
      durationMs: { type: "number" },
    },
    required: [
      "queryName",
      "operation",
      "mutation",
      "simulated",
      "rows",
      "rowCount",
      "truncated",
      "durationMs",
    ],
  },
  dryRun(input, ctx) {
    return asStep(async () => {
      const query = decodeSaved(await loadSaved(input));
      await assertKnownTarget(query);
      if (!query.mutation) return run(query, ctx);
      const startedAt = Date.now();
      const measure = await dryRun(query.root);
      return {
        queryName: query.name,
        operation: query.operation,
        mutation: true,
        simulated: true,
        rows: [],
        rowCount: measure.rows,
        truncated: false,
        durationMs: Date.now() - startedAt,
      };
    });
  },
  execute(input, ctx) {
    return asStep(async () => {
      const query = decodeSaved(await loadSaved(input));
      await assertKnownTarget(query);
      return run(query, ctx);
    });
  },
};
