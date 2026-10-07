import { CROSS_INSTANCE, Query } from "@antelopejs/interface-database";
import { CROSS_INSTANCE_SENTINEL } from "../types/constants";
import type { QueryStage } from "./stagedSerialization";

const MUTATING_STAGES = new Set(["insert", "update", "replace", "delete"]);

export type QueryOperation =
  | "read"
  | "insert"
  | "update"
  | "replace"
  | "delete";

/** Where a query reads or writes, as far as its chain names it. */
export interface QueryTarget {
  schema?: string;
  instance?: string;
  table?: string;
}

/** What a mutating query is about to do, measured before it runs. */
export interface DryRunResult extends QueryTarget {
  operation: QueryOperation;
  /**
   * Rows the write would touch: the documents an insert carries, or the rows
   * its selection matches. Null when the write is nested in another stage and
   * cannot be measured on its own.
   */
  rows: number | null;
}

interface StagedLike {
  stages?: unknown;
}

function stagesOf(value: unknown): QueryStage[] {
  const stages = (value as StagedLike | null)?.stages;
  return Array.isArray(stages) ? (stages as QueryStage[]) : [];
}

function optionId(stage: QueryStage | undefined): unknown {
  return (stage?.options as { id?: unknown } | undefined)?.id;
}

function instanceLabel(id: unknown): string | undefined {
  if (id === CROSS_INSTANCE || id === CROSS_INSTANCE_SENTINEL) return "*";
  return typeof id === "string" ? id : undefined;
}

/** The schema, instance and table a query chain starts from. */
export function readQueryTarget(root: unknown): QueryTarget {
  const stages = stagesOf(root);
  const find = (name: string) => stages.find((stage) => stage.stage === name);
  const schema = optionId(find("schema"));
  const table = optionId(find("table"));
  const instanceStage = find("instance");
  return {
    schema: typeof schema === "string" ? schema : undefined,
    // `instance()` with no id is the default instance.
    instance: instanceStage
      ? (instanceLabel(optionId(instanceStage)) ?? "")
      : undefined,
    table: typeof table === "string" ? table : undefined,
  };
}

/** Whether any stage of the chain, or of a query it embeds, writes. */
export function containsMutation(root: unknown): boolean {
  return stagesOf(root).some(
    (stage) =>
      MUTATING_STAGES.has(stage.stage) ||
      (Array.isArray(stage.args) && stage.args.some(containsMutation)),
  );
}

function stagedQuery(stages: QueryStage[]): Query<unknown> {
  const query = Object.create(Query.prototype) as Query<unknown> & StagedLike;
  query.stages = stages;
  return query;
}

async function countSelected(prefix: QueryStage[]): Promise<number> {
  // A single-row selection (`get`) answers the row or nothing.
  if (prefix.at(-1)?.stage === "get") {
    const row = await stagedQuery(prefix).run();
    return row === null || row === undefined ? 0 : 1;
  }
  const count = await stagedQuery([
    ...prefix,
    { stage: "count", options: { field: undefined }, args: [] },
  ]).run();
  return typeof count === "number" ? count : 0;
}

function insertedDocuments(stage: QueryStage): number {
  const [documents] = stage.args ?? [];
  return Array.isArray(documents) ? documents.length : 1;
}

/**
 * Measures what a query would write without writing: the operation of its
 * first mutating stage and the rows that stage would touch.
 */
export async function dryRun(root: unknown): Promise<DryRunResult> {
  const stages = stagesOf(root);
  const target = readQueryTarget(root);
  const index = stages.findIndex((stage) => MUTATING_STAGES.has(stage.stage));
  if (index < 0) {
    const nested = containsMutation(root);
    return nested
      ? { ...target, operation: "update", rows: null }
      : { ...target, operation: "read", rows: 0 };
  }
  const stage = stages[index];
  const operation = stage.stage as QueryOperation;
  const rows =
    operation === "insert"
      ? insertedDocuments(stage)
      : await countSelected(stages.slice(0, index));
  return { ...target, operation, rows };
}
