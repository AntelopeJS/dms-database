import { CROSS_INSTANCE, Query, Schema } from "@antelopejs/interface-database";
import {
  type QueryStage,
  StagedObject,
} from "@antelopejs/interface-database/common";
import { CROSS_INSTANCE_SENTINEL } from "../types/constants";
import { isFiniteNumber, isNumber, isString } from "../utils/guards";
import { listSchemaInstances } from "./introspect";

const MUTATING_STAGES = ["insert", "update", "replace", "delete"] as const;

function isMutatingStage(
  name: string,
): name is (typeof MUTATING_STAGES)[number] {
  return MUTATING_STAGES.some((mutating) => mutating === name);
}

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

function optionId(
  stage: QueryStage | undefined,
): string | typeof CROSS_INSTANCE | undefined {
  const id: unknown = stage?.options?.id;
  if (isString(id)) return id;
  return id === CROSS_INSTANCE ? CROSS_INSTANCE : undefined;
}

function instanceLabel(
  id: string | typeof CROSS_INSTANCE | undefined,
): string | undefined {
  return id === CROSS_INSTANCE || id === CROSS_INSTANCE_SENTINEL ? "*" : id;
}

/**
 * The schema, instance and table a query chain starts from. An `instance()`
 * with no id is the default instance.
 */
export function readQueryTarget(root: StagedObject): QueryTarget {
  const stages = root.build();
  const find = (name: string) => stages.find((stage) => stage.stage === name);
  const schema = optionId(find("schema"));
  const table = optionId(find("table"));
  const instanceStage = find("instance");
  return {
    schema: isString(schema) ? schema : undefined,
    instance: instanceStage
      ? (instanceLabel(optionId(instanceStage)) ?? "")
      : undefined,
    table: isString(table) ? table : undefined,
  };
}

/** Whether any stage of the chain, or of a query it embeds, writes. */
export function containsMutation(root: StagedObject): boolean {
  return root
    .build()
    .some(
      (stage) =>
        isMutatingStage(stage.stage) ||
        stage.args.some(
          (arg) => arg instanceof StagedObject && containsMutation(arg),
        ),
    );
}

/** The query a non-empty chain of stages describes. */
function stagedQuery(stages: QueryStage[]): Query<unknown> {
  const [first, ...rest] = stages;
  return rest.reduce(
    (previous, stage) => new Query(stage, previous),
    new Query<unknown>(first),
  );
}

/** A single-row selection (`get`) answers the row or nothing. */
async function countSelected(prefix: QueryStage[]): Promise<number> {
  if (prefix.at(-1)?.stage === "get") {
    const row = await stagedQuery(prefix).run();
    return row === null || row === undefined ? 0 : 1;
  }
  const count: unknown = await stagedQuery([
    ...prefix,
    { stage: "count", options: { field: undefined }, args: [] },
  ]).run();
  return isNumber(count) ? count : 0;
}

function insertedDocuments(stage: QueryStage): number {
  const [documents] = stage.args ?? [];
  return Array.isArray(documents) ? documents.length : 1;
}

/**
 * Measures what a query would write without writing: the operation of its
 * first mutating stage and the rows that stage would touch.
 */
export async function dryRun(root: StagedObject): Promise<DryRunResult> {
  const stages = root.build();
  const target = readQueryTarget(root);
  const index = stages.findIndex((stage) => isMutatingStage(stage.stage));
  const stage = stages[index];
  if (index < 0 || !isMutatingStage(stage.stage)) {
    const nested = containsMutation(root);
    return nested
      ? { ...target, operation: "update", rows: null }
      : { ...target, operation: "read", rows: 0 };
  }
  const operation = stage.stage;
  const rows =
    operation === "insert"
      ? insertedDocuments(stage)
      : await countSelected(stages.slice(0, index));
  return { ...target, operation, rows };
}

/**
 * Instances named in an unknown-instance error, so the message stays short
 * on a schema with one instance per tenant.
 */
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
  return mutation && isFiniteNumber(raw) ? raw : rows;
}
