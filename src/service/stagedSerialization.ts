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
import {
  type QueryStage,
  StagedObject,
} from "@antelopejs/interface-database/common";
import { CROSS_INSTANCE_SENTINEL } from "../types/constants";
import {
  isJsonObjectValue,
  type JsonObject,
  type JsonValue,
} from "../types/json";

const STAGED_CLASSES = {
  Schema,
  SchemaInstance,
  Table,
  Selection,
  SingleSelection,
  Stream,
  Datum,
  Query,
  ValueProxy,
} satisfies Record<string, new (...args: never[]) => StagedObject>;

type StagedClassName = keyof typeof STAGED_CLASSES;

/** What a query body decodes to: its JSON, with staged values rebuilt. */
export type Decoded =
  | string
  | number
  | boolean
  | null
  | undefined
  | typeof CROSS_INSTANCE
  | StagedObject
  | Decoded[]
  | { [key: string]: Decoded };

interface SerializedStage extends JsonObject {
  stage: string;
  args: JsonValue[];
}

interface SerializedStaged extends JsonObject {
  __cls: StagedClassName;
  stages: SerializedStage[];
}

/** A query body the server refuses to decode: the route answers 400. */
export class StagedDecodeError extends Error {}

function isSerializedStage(
  stage: JsonValue | undefined,
): stage is SerializedStage {
  return (
    stage !== undefined &&
    isJsonObjectValue(stage) &&
    typeof stage.stage === "string" &&
    stage.stage !== "" &&
    Array.isArray(stage.args)
  );
}

function isStagedClassName(
  name: JsonValue | undefined,
): name is StagedClassName {
  return typeof name === "string" && Object.hasOwn(STAGED_CLASSES, name);
}

function isSerializedStaged(
  value: JsonValue | undefined,
): value is SerializedStaged {
  return (
    value !== undefined &&
    isJsonObjectValue(value) &&
    isStagedClassName(value.__cls) &&
    Array.isArray(value.stages) &&
    value.stages.every(isSerializedStage)
  );
}

/**
 * An object carrying the keys of a staged value is one, or a forgery: decoded
 * as a plain object, a malformed predicate would reach the driver as an
 * always-true expression, and `filter(...).delete()` would empty the table.
 */
function looksStaged(value: JsonObject): boolean {
  return Object.hasOwn(value, "__cls") || Object.hasOwn(value, "stages");
}

export function decodeStaged(value: JsonValue | undefined): Decoded {
  if (value === null || value === undefined) return value;
  if (value === CROSS_INSTANCE_SENTINEL) return CROSS_INSTANCE;
  if (Array.isArray(value)) return value.map(decodeStaged);
  if (!isJsonObjectValue(value)) return value;

  if (isSerializedStaged(value)) {
    const ctor = STAGED_CLASSES[value.__cls];
    const instance = Reflect.construct(
      StagedObject,
      [{ stage: "", options: undefined, args: [] }],
      ctor,
    );
    return Object.assign(instance, { stages: value.stages.map(decodeStage) });
  }
  if (looksStaged(value)) {
    throw new StagedDecodeError("Malformed query: invalid staged value");
  }

  const out: { [key: string]: Decoded } = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = decodeStaged(v);
  }
  return out;
}

/** Whether a function body is a constant: anything but an object or an array. */
function isConstantBody(body: JsonValue | undefined): boolean {
  return (
    body === undefined ||
    body === null ||
    !(Array.isArray(body) || isJsonObjectValue(body))
  );
}

/**
 * A function argument (a filter's predicate, a map's projection) travels as
 * `{ stage: "func", args: [argIds, body] }`; its body is what the driver
 * compiles, so it must be a staged value or a constant.
 */
function decodeStageArg(arg: JsonValue): Decoded {
  if (!isJsonObjectValue(arg) || arg.stage !== "func") return decodeStaged(arg);
  const [argIds, body] = Array.isArray(arg.args) ? arg.args : [];
  if (
    !Array.isArray(argIds) ||
    !(isConstantBody(body) || isSerializedStaged(body))
  ) {
    throw new StagedDecodeError("Malformed query: invalid function body");
  }
  return { stage: "func", args: [argIds, decodeStaged(body)] };
}

function decodeStage(stage: SerializedStage): QueryStage {
  const decoded: QueryStage = {
    stage: stage.stage,
    args: stage.args.map(decodeStageArg),
  };
  if (stage.options !== undefined)
    decoded.options = decodeStaged(stage.options);
  return decoded;
}
