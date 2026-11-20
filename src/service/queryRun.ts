import { HTTPResult } from "@antelopejs/interface-api";
import { Query, Stream } from "@antelopejs/interface-database";
import type { JsonObject } from "../types/json";
import { isBoolean, isNumber, isObject, isString } from "../utils/guards";
import {
  type Decoded,
  decodeStaged,
  StagedDecodeError,
} from "./stagedSerialization";
import type { ExecuteResult } from "./types";

/**
 * A failed run answers what failed and how long it took.
 *
 * @param message What failed
 * @param durationMs How long the run took
 * @returns The refusal to throw
 */
export function runFailure(message: string, durationMs: number): HTTPResult {
  return new HTTPResult(400, { message, durationMs });
}

/**
 * Decodes a saved or sent query to the query it runs. A body that does not
 * decode to a runnable query reaches no table: it answers like a failed run,
 * in no time.
 *
 * @param query The query's wire form
 * @returns The query
 */
export function decodeRunnable(query: JsonObject): Query<unknown> {
  let root: Decoded;
  try {
    root = decodeStaged(query);
  } catch (error) {
    if (error instanceof StagedDecodeError) throw runFailure(error.message, 0);
    throw error;
  }
  if (!(root instanceof Query)) {
    throw runFailure(
      "Query must resolve to a runnable expression (Table/Selection/Stream/Datum/Query)",
      0,
    );
  }
  return root;
}

/** What running a query answers, or one entry of an answered list: the query declares no result type. */
export type QueryAnswer = Awaited<ReturnType<Query<unknown>["run"]>>;

type QueryRow = ExecuteResult["rows"][number];

function isRow(value: QueryAnswer): value is QueryRow {
  return isObject(value) && !Array.isArray(value);
}

type ScalarAnswer = string | number | boolean | null;

function isScalarAnswer(value: QueryAnswer): value is ScalarAnswer {
  return (
    value === null || isString(value) || isNumber(value) || isBoolean(value)
  );
}

function isList(value: QueryAnswer): value is QueryAnswer[] {
  return Array.isArray(value);
}

function rowOf(entry: QueryAnswer): QueryRow {
  if (isRow(entry)) return entry;
  if (isList(entry) || isScalarAnswer(entry)) return { value: entry };
  return {};
}

/**
 * The rows of a query's answer, as the console's grid shows them: an object
 * as is, a scalar or a list as `{ value }`. Anything else (a bigint, a
 * symbol, a function, an `undefined` list entry) has no JSON form, so its row
 * is empty.
 *
 * @param raw What the query answered
 * @returns The rows
 */
export function normaliseRows(raw: QueryAnswer): ExecuteResult["rows"] {
  if (isList(raw)) return raw.map((entry) => rowOf(entry));
  if (isRow(raw)) return [raw];
  if (isScalarAnswer(raw)) return [{ value: raw }];
  return raw === undefined ? [] : [{}];
}

/** What a run answered. */
export interface RunAnswer {
  raw: QueryAnswer;
  /** The rows a read stream holds, counted in the database when it holds more than the run reads. */
  total?: number;
}

/**
 * Runs a query. A read stream is read from its cursor and closed one row past
 * `maxRows`, so a run never takes a whole table; the query itself is
 * unchanged, so ties keep the order a full run gives them, which a `slice`
 * sorted by the database would not.
 *
 * @param root The query
 * @param mutation Whether the query writes
 * @param maxRows The rows a read keeps at most
 * @returns The answer
 */
export async function runQuery(
  root: Query<unknown>,
  mutation: boolean,
  maxRows: number,
): Promise<RunAnswer> {
  if (mutation || !(root instanceof Stream)) return { raw: await root.run() };
  const raw: QueryAnswer[] = [];
  for await (const row of root.cursor()) {
    raw.push(row);
    if (raw.length > maxRows) break;
  }
  if (raw.length <= maxRows) return { raw };
  return { raw, total: await root.count().run() };
}
