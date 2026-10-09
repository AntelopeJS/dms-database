import type { TableViewOptionsSerialized } from "@antelopejs/interface-dms/base/table-view";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { parseFilter } from "../utils/query";

// The Schemas page's filter bar (a frontend component above the table view)
// keeps its state in the URL: `scope` (a schema), `instance`, `q` (a table
// or column name) and `has` (relations, modifiers, empty). The table view
// reads these keys from the URL as hidden filters and sends them to its
// source route as `filter_<key>=is:<value>`, which reads them back here.

/** The URL keys of the filter bar, each filtering on the field of its name. */
export const SCHEMA_FILTER_KEYS = ["scope", "instance", "q", "has"] as const;
export type SchemaFilterKey = (typeof SCHEMA_FILTER_KEYS)[number];

/** The URL's `instance` for the default instance; no value means all. */
export const DEFAULT_INSTANCE_PARAM = "default";
// Prefixed to a named instance that would read as the default one, or as
// escaped (an instance really named "default" is written "~default").
const INSTANCE_ESCAPE = "~";

export const HAS_FLAGS = ["relations", "modifiers", "empty"] as const;
export type HasFlag = (typeof HAS_FLAGS)[number];
const HAS_SEPARATOR = ",";

/** Every instance (one cross-instance count), the default one, or a named one. */
export type InstanceChoice =
  | { kind: "all" }
  | { kind: "default" }
  | { kind: "named"; id: string };

/** The URL's `instance` back to the instance it names. */
export function decodeInstanceParam(param: string | undefined): InstanceChoice {
  if (!param) return { kind: "all" };
  if (param === DEFAULT_INSTANCE_PARAM) return { kind: "default" };
  return {
    kind: "named",
    id: param.startsWith(INSTANCE_ESCAPE) ? param.slice(1) : param,
  };
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
  /**
   * The values as the URL carries them, empty when unset: each row hands
   * them back so its Inspect link keeps the bar's state.
   */
  echo: Record<SchemaFilterKey, string>;
}

// A hidden filter arrives as `<mode>:<value>`; the bar only ever sends `is`.
function filterValue(raw: unknown): string {
  return parseFilter(raw)?.value.trim() ?? "";
}

/** The filter bar's state from the `filter_<key>` values of a list query. */
export function readSchemaFilters(
  raw: Partial<Record<SchemaFilterKey, unknown>>,
): SchemaFilters {
  const echo = {
    scope: filterValue(raw.scope),
    instance: filterValue(raw.instance),
    q: filterValue(raw.q),
    has: filterValue(raw.has),
  };
  const has = parseHasFlags(echo.has);
  return {
    scope: echo.scope || undefined,
    instance: decodeInstanceParam(echo.instance),
    q: echo.q || undefined,
    has,
    echo: { ...echo, has: has.join(HAS_SEPARATOR) },
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
