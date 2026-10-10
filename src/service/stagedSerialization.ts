import {
  CROSS_INSTANCE,
  Datum,
  Query,
  Schema,
  SchemaInstance,
  Selection,
  SingleSelection,
  Stream,
  Table,
  ValueProxy,
} from "@antelopejs/interface-database";

import { CROSS_INSTANCE_SENTINEL } from "../types/constants";

export interface QueryStage {
  stage: string;
  options?: unknown;
  args: unknown[];
}

type StagedCtor = new (...args: never[]) => unknown;

const STAGED_CLASSES: Record<string, StagedCtor> = {
  Schema,
  SchemaInstance,
  Table,
  Selection,
  SingleSelection,
  Stream,
  Datum,
  Query,
  ValueProxy,
};

interface SerializedStaged {
  __cls: string;
  stages: unknown[];
}

/** A query body the server refuses to decode: the route answers 400. */
export class StagedDecodeError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSerializedStage(stage: unknown): boolean {
  return (
    isRecord(stage) &&
    typeof stage.stage === "string" &&
    stage.stage !== "" &&
    Array.isArray(stage.args)
  );
}

function isSerializedStaged(value: unknown): value is SerializedStaged {
  return (
    isRecord(value) &&
    typeof value.__cls === "string" &&
    Object.hasOwn(STAGED_CLASSES, value.__cls) &&
    Array.isArray(value.stages) &&
    value.stages.every(isSerializedStage)
  );
}

// An object carrying the keys of a staged value is one, or a forgery: decoded
// as a plain object, a malformed predicate would reach the driver as an
// always-true expression, and `filter(...).delete()` would empty the table.
function looksStaged(value: Record<string, unknown>): boolean {
  return Object.hasOwn(value, "__cls") || Object.hasOwn(value, "stages");
}

export function decodeStaged(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  // The symbol JSON cannot carry, sent as its sentinel by the console.
  if (value === CROSS_INSTANCE_SENTINEL) return CROSS_INSTANCE;
  if (Array.isArray(value)) return value.map(decodeStaged);
  if (typeof value !== "object") return value;

  if (isSerializedStaged(value)) {
    const ctor = STAGED_CLASSES[value.__cls];
    const instance = Object.create(ctor.prototype) as { stages: unknown[] };
    instance.stages = value.stages.map(decodeStage);
    return instance;
  }
  const record = value as Record<string, unknown>;
  if (looksStaged(record)) {
    throw new StagedDecodeError("Malformed query: invalid staged value");
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(record)) {
    out[key] = decodeStaged(v);
  }
  return out;
}

// A function argument (a filter's predicate, a map's projection) travels as
// `{ stage: "func", args: [argIds, body] }`; its body is what the driver
// compiles, so it must be a staged value or a constant.
function decodeStageArg(arg: unknown): unknown {
  if (!isRecord(arg) || arg.stage !== "func") return decodeStaged(arg);
  const [argIds, body] = Array.isArray(arg.args) ? arg.args : [];
  const constant = body === null || typeof body !== "object";
  if (!Array.isArray(argIds) || !(constant || isSerializedStaged(body))) {
    throw new StagedDecodeError("Malformed query: invalid function body");
  }
  return { stage: "func", args: [argIds, decodeStaged(body)] };
}

function decodeStage(stage: unknown): QueryStage {
  const { stage: name, options, args } = stage as QueryStage;
  const decoded: QueryStage = { stage: name, args: args.map(decodeStageArg) };
  if (options !== undefined) decoded.options = decodeStaged(options);
  return decoded;
}
