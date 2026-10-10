import { CROSS_INSTANCE, Query, Schema } from "@antelopejs/interface-database";
import { CROSS_INSTANCE_SENTINEL } from "../types/constants";
import { listSchemaInstances } from "./introspect";
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

// Instances named in an unknown-instance error, so the message stays short
// on a schema with one instance per tenant.
const LISTED_INSTANCES = 10;

/**
 * Why a query cannot run where it points: an unknown schema, table or
 * instance. A store reading a missing table, or an instance that was never
 * created, answers no row, which reads like an empty table; the console says
 * what is wrong instead.
 */
export async function describeUnknownQueryTarget(
  target: QueryTarget,
): Promise<string | null> {
  if (!target.schema) return null;
  const schema = Schema.get(target.schema);
  if (!schema) return `Unknown schema "${target.schema}"`;
  if (target.table && !(target.table in schema.definition)) {
    return `Unknown table "${target.table}" in schema ${target.schema}`;
  }
  // The default instance ("") and every instance at once ("*") always exist.
  const instance = target.instance;
  if (!instance || instance === "*") return null;
  const named = await listSchemaInstances(schema);
  if (named.includes(instance)) return null;
  const listed = named.slice(0, LISTED_INSTANCES).map((id) => `"${id}"`);
  const more = named.length > listed.length ? ", …" : "";
  const known = listed.length
    ? ` (instances: ${listed.join(", ")}${more})`
    : " (it has no named instance)";
  return `Unknown instance "${instance}" in schema ${target.schema}${known}`;
}

/**
 * Rows a run changed or answered: update, replace and delete answer the
 * number of rows they touched, not rows.
 */
export function affectedRows(
  raw: unknown,
  rows: number,
  mutation: boolean,
): number {
  return mutation && typeof raw === "number" && Number.isFinite(raw)
    ? raw
    : rows;
}
