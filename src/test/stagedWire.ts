import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import {
  type QueryStage,
  StagedObject,
} from "@antelopejs/interface-database/common";
import { CROSS_INSTANCE_SENTINEL } from "../types/constants";
import { isJsonObject, type JsonObject } from "../types/json";
import { isObject } from "../utils/guards";

const STAGED_CLASS_NAMES = new Set([
  "Schema",
  "SchemaInstance",
  "Table",
  "Selection",
  "SingleSelection",
  "Stream",
  "Datum",
  "Query",
  "ValueProxy",
]);

type Node =
  | string
  | number
  | boolean
  | null
  | undefined
  | typeof CROSS_INSTANCE
  | StagedObject
  | Node[]
  | { [key: string]: Node };

type Wire =
  | string
  | number
  | boolean
  | null
  | undefined
  | Wire[]
  | { [key: string]: Wire };

/** Tells whether a value nested in a stage is one the wire form encodes. */
function isNode(value: unknown): value is Node {
  if (
    value === null ||
    value === undefined ||
    value === CROSS_INSTANCE ||
    value instanceof StagedObject
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isNode);
  if (isObject(value)) return Object.values(value).every(isNode);
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function encodeStage({ stage, options, args }: QueryStage): Wire {
  const values: unknown[] = [...args];
  if (!isNode(options) || !values.every(isNode)) {
    throw new Error(`stage ${stage} holds a value the wire form cannot encode`);
  }
  return encodeNode({ stage, options, args: values });
}

function encodeNode(node: Node): Wire {
  if (node === CROSS_INSTANCE) return CROSS_INSTANCE_SENTINEL;
  if (Array.isArray(node)) return node.map(encodeNode);
  if (!isObject(node)) return node;
  if (node instanceof StagedObject) {
    const cls = node.constructor.name;
    if (STAGED_CLASS_NAMES.has(cls)) {
      return {
        __cls: cls,
        stages: node.build().map(encodeStage),
      };
    }
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, encodeNode(value)]),
  );
}

/**
 * The wire form of a staged query, as the console sends it: every staged
 * value nested in a stage (a filter's predicate, say) is encoded too, and the
 * whole travels as JSON.
 */
export function encode(staged: StagedObject): JsonObject {
  const wire: unknown = JSON.parse(JSON.stringify(encodeNode(staged)));
  if (!isJsonObject(wire))
    throw new Error("a staged query encodes to an object");
  return wire;
}
