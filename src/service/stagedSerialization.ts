import {
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

function isSerializedStaged(value: unknown): value is SerializedStaged {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { __cls?: unknown }).__cls === "string" &&
    Array.isArray((value as { stages?: unknown }).stages) &&
    typeof STAGED_CLASSES[(value as SerializedStaged).__cls] === "function"
  );
}

export function decodeStaged(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(decodeStaged);
  if (typeof value !== "object") return value;

  if (isSerializedStaged(value)) {
    const ctor = STAGED_CLASSES[value.__cls];
    const instance = Object.create(ctor.prototype) as { stages: unknown[] };
    instance.stages = value.stages.map(decodeStage);
    return instance;
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = decodeStaged(v);
  }
  return out;
}

function decodeStage(stage: unknown): unknown {
  if (!stage || typeof stage !== "object") return stage;
  const { stage: name, options, args } = stage as Partial<QueryStage>;
  const decoded: QueryStage = {
    stage: typeof name === "string" ? name : "",
    args: Array.isArray(args) ? args.map(decodeStaged) : [],
  };
  if (options !== undefined) decoded.options = decodeStaged(options);
  return decoded;
}
