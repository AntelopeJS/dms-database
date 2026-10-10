import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { CROSS_INSTANCE_SENTINEL } from "../types/constants";

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

function encodeNode(node: unknown): unknown {
  if (node === CROSS_INSTANCE) return CROSS_INSTANCE_SENTINEL;
  if (Array.isArray(node)) return node.map(encodeNode);
  if (node === null || typeof node !== "object") return node;
  const cls = node.constructor?.name;
  if (cls && STAGED_CLASS_NAMES.has(cls)) {
    const stages = (node as { stages?: unknown[] }).stages ?? [];
    return { __cls: cls, stages: stages.map(encodeNode) };
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, encodeNode(value)]),
  );
}

interface StagedLike {
  stages: unknown[];
}

/**
 * The wire form of a staged query, as the console sends it: every staged
 * value nested in a stage (a filter's predicate, say) is encoded too, and the
 * whole travels as JSON.
 */
export function encode(staged: StagedLike): Record<string, unknown> {
  return JSON.parse(JSON.stringify(encodeNode(staged))) as Record<
    string,
    unknown
  >;
}
