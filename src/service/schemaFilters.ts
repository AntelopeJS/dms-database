import type { TableViewOptionsSerialized } from "@antelopejs/interface-dms/base/table-view";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { parseFilter } from "../utils/query";

// The Schemas page's filter bar (a frontend component above the table view)
// keeps its state in the URL: `scope` (a schema), `instance`, `q` (a table
// or column name) and `has` (relations, modifiers, empty). The table view
// reads these keys from the URL as hidden filters and sends them to its
// source route as `filter_<key>=is:<value>`, which reads them back here.

/** The URL keys of the filter bar, each filtering on the field of its name. */
const SCHEMA_FILTER_KEYS = ["scope", "instance", "q", "has"] as const;
type SchemaFilterKey = (typeof SCHEMA_FILTER_KEYS)[number];

/** The URL's `instance` for every instance; no value means the default one. */
const ALL_INSTANCES_PARAM = "all";

const HAS_FLAGS = ["relations", "modifiers", "empty"] as const;
type HasFlag = (typeof HAS_FLAGS)[number];
const HAS_SEPARATOR = ",";

/** Every instance (one cross-instance count), the default one, or a named one. */
export type InstanceChoice =
  | { kind: "all" }
  | { kind: "default" }
  | { kind: "named"; id: string };

/**
 * The URL's `instance` back to the instance it names, the module's one
 * convention: absent is the default instance, `all` every instance, any other
 * value the instance of that name.
 */
export function decodeInstanceParam(param: string | undefined): InstanceChoice {
  if (!param) return { kind: "default" };
  if (param === ALL_INSTANCES_PARAM) return { kind: "all" };
  return { kind: "named", id: param };
}

/** The flags of a `has` value, known ones only, each once. */
export function parseHasFlags(param: string | undefined): HasFlag[] {
  if (!param) return [];
  const asked = new Set(param.split(HAS_SEPARATOR).map((flag) => flag.trim()));
  return HAS_FLAGS.filter((flag) => asked.has(flag));
}

/** The filter bar's state as the source route reads it. */
export interface SchemaFilters {
  scope?: string;
  instance: InstanceChoice;
  q?: string;
  has: HasFlag[];
}

// A hidden filter arrives as `<mode>:<value>`; the bar only ever sends `is`.
function filterValue(raw: unknown): string {
  return parseFilter(raw)?.value.trim() ?? "";
}

/** The filter bar's state from the `filter_<key>` values of a list query. */
export function readSchemaFilters(
  raw: Partial<Record<SchemaFilterKey, unknown>>,
): SchemaFilters {
  return {
    scope: filterValue(raw.scope) || undefined,
    instance: decodeInstanceParam(filterValue(raw.instance)),
    q: filterValue(raw.q) || undefined,
    has: parseHasFlags(filterValue(raw.has)),
  };
}

type TableViewBuilder = ComponentBuilder<TableViewOptionsSerialized>;

/**
 * Hands the Schemas table view over to the page's filter bar: the view reads
 * the bar's URL keys as hidden filters (`queryParamFilters`, which the source
 * options do not offer) and drops its own search, which the bar replaces.
 * Both are static options, merged once onto what the factory serialized.
 */
export function addSchemaFilters(builder: TableViewBuilder): TableViewBuilder {
  return builder.mergeOptions({
    searchable: false,
    queryParamFilters: Object.fromEntries(
      SCHEMA_FILTER_KEYS.map((key) => [key, { field: key }]),
    ),
  });
}
