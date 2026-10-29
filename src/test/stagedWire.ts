import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { StagedObject } from "@antelopejs/interface-database/common";
import { CROSS_INSTANCE_SENTINEL } from "../types/constants";
import { isJsonObject, type JsonObject, type JsonValue } from "../types/json";
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

function encodeNode(node: Node): Wire {
  if (node === CROSS_INSTANCE) return CROSS_INSTANCE_SENTINEL;
  if (Array.isArray(node)) return node.map(encodeNode);
  if (!isObject(node)) return node;
  if (node instanceof StagedObject) {
    const cls = node.constructor.name;
    if (STAGED_CLASS_NAMES.has(cls)) {
      return {
        __cls: cls,
        stages: node
          .build()
          .map(({ stage, options, args }) =>
            encodeNode({ stage, options, args }),
          ),
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
  const wire: JsonValue = JSON.parse(JSON.stringify(encodeNode(staged)));
  if (!isJsonObject(wire))
    throw new Error("a staged query encodes to an object");
  return wire;
}
