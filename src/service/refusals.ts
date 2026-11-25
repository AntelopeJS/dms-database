import { HTTPResult } from "@antelopejs/interface-api";

/** How the dashboard's toast shows a refusal. */
type Severity = "warning" | "error";

/** One refusal: its status, the translation key of its sentence and the values the sentence names. */
export interface RefusalSpec {
  readonly status: number;
  readonly key: `$dms_database.${string}`;
  readonly params: readonly string[];
  readonly severity?: Severity;
}

/**
 * Every refusal the module answers. The dashboard's error presenter shows a refusal only through a
 * key its locales hold, filled with the refusal's params.
 */
export const REFUSALS = {
  unknownConnection: {
    status: 404,
    key: "$dms_database.connections.unknown",
    params: [],
  },
  notDevelopment: {
    status: 403,
    key: "$dms_database.connections.access.not_development",
    params: [],
  },
  readOnlyAccount: {
    status: 409,
    key: "$dms_database.connections.access.account_read_only",
    params: [],
  },
  unverifiedAccount: {
    status: 409,
    key: "$dms_database.connections.access.account_unverified",
    params: [],
  },
  noModuleEntry: {
    status: 503,
    key: "$dms_database.connections.access.no_module_entry",
    params: [],
  },
  noBuilder: {
    status: 503,
    key: "$dms_database.connections.access.no_builder",
    params: [],
  },
  builderRefused: {
    status: 409,
    key: "$dms_database.connections.access.refused",
    params: ["reason"],
  },
  catalogTimedOut: {
    status: 409,
    key: "$dms_database.connections.catalog.timed_out",
    params: ["connection"],
  },
  catalogRefused: {
    status: 409,
    key: "$dms_database.connections.catalog.refused",
    params: ["connection"],
  },
  staleDatabase: {
    status: 409,
    key: "$dms_database.data.save.database_changed",
    params: [],
    severity: "warning",
  },
  readOnlyConnection: {
    status: 403,
    key: "$dms_database.data.save.read_only_access",
    params: ["connection"],
    severity: "warning",
  },
  ownDatabaseAccess: {
    status: 400,
    key: "$dms_database.refusals.own_database_access",
    params: [],
  },
  selectionBody: {
    status: 400,
    key: "$dms_database.refusals.selection_body",
    params: [],
  },
  accessBody: {
    status: 400,
    key: "$dms_database.refusals.access_body",
    params: [],
  },
  editBody: {
    status: 400,
    key: "$dms_database.refusals.edit_body",
    params: [],
  },
  missingParameter: {
    status: 400,
    key: "$dms_database.refusals.missing_parameter",
    params: ["name"],
  },
  emptyValue: {
    status: 400,
    key: "$dms_database.refusals.empty_value",
    params: [],
  },
  unknownRelation: {
    status: 404,
    key: "$dms_database.refusals.unknown_relation",
    params: ["relation"],
  },
  unknownSchema: {
    status: 404,
    key: "$dms_database.refusals.unknown_schema",
    params: ["schema"],
  },
  unknownTable: {
    status: 404,
    key: "$dms_database.refusals.unknown_table",
    params: ["table"],
  },
  unknownColumn: {
    status: 400,
    key: "$dms_database.refusals.unknown_column",
    params: ["column"],
  },
  noInstances: {
    status: 400,
    key: "$dms_database.refusals.no_instances",
    params: ["connection"],
  },
  crossInstanceReferences: {
    status: 400,
    key: "$dms_database.refusals.cross_instance_references",
    params: [],
  },
  crossInstanceEdit: {
    status: 400,
    key: "$dms_database.refusals.cross_instance_edit",
    params: [],
  },
  rowNotFound: {
    status: 404,
    key: "$dms_database.refusals.row_not_found",
    params: [],
  },
  invalidDate: {
    status: 400,
    key: "$dms_database.refusals.invalid_date",
    params: ["field", "value"],
  },
  nestedFilterColumn: {
    status: 400,
    key: "$dms_database.refusals.nested_filter_column",
    params: ["column"],
  },
  unfilterableColumn: {
    status: 400,
    key: "$dms_database.refusals.unfilterable_column",
    params: ["column"],
  },
  layoutBody: {
    status: 400,
    key: "$dms_database.refusals.layout_body",
    params: [],
  },
  invalidPosition: {
    status: 400,
    key: "$dms_database.refusals.invalid_position",
    params: ["table"],
  },
  invalidNumber: {
    status: 400,
    key: "$dms_database.refusals.invalid_number",
    params: ["field"],
  },
  noteNotFound: {
    status: 404,
    key: "$dms_database.refusals.note_not_found",
    params: [],
  },
  savedQueryBody: {
    status: 400,
    key: "$dms_database.refusals.saved_query_body",
    params: [],
  },
  savedQueryNotRunnable: {
    status: 400,
    key: "$dms_database.refusals.saved_query_not_runnable",
    params: [],
  },
  unsupportedLanguage: {
    status: 400,
    key: "$dms_database.refusals.unsupported_language",
    params: [],
  },
  savedQueryNotFound: {
    status: 404,
    key: "$dms_database.refusals.saved_query_not_found",
    params: [],
  },
  historyEntryNotFound: {
    status: 404,
    key: "$dms_database.refusals.history_entry_not_found",
    params: [],
  },
  externalMigrations: {
    status: 409,
    key: "$dms_database.refusals.external.migrations",
    params: [],
  },
  externalSchemaEdits: {
    status: 409,
    key: "$dms_database.refusals.external.schema_edits",
    params: [],
  },
  externalIndexes: {
    status: 409,
    key: "$dms_database.refusals.external.indexes",
    params: [],
  },
  externalQueryConsole: {
    status: 409,
    key: "$dms_database.refusals.external.query_console",
    params: [],
  },
  externalInstances: {
    status: 409,
    key: "$dms_database.refusals.external.instances",
    params: [],
  },
  externalRowReferences: {
    status: 409,
    key: "$dms_database.refusals.external.row_references",
    params: [],
  },
} as const satisfies Record<string, RefusalSpec>;

/** The values a refusal's sentence names, none for a sentence that names none. */
type ParamsArg<S extends RefusalSpec> = S["params"] extends readonly []
  ? []
  : [params: Readonly<Record<S["params"][number], string>>];

/**
 * The HTTP error a refusal answers: its key, its params and its severity, as the dashboard's error
 * presenter reads them.
 *
 * @param spec The refusal, from {@link REFUSALS}
 * @param params The values its sentence names
 * @returns The result to throw
 */
export function refusal<S extends RefusalSpec>(
  spec: S,
  ...[params]: ParamsArg<S>
): HTTPResult {
  return new HTTPResult(spec.status, {
    message: spec.key,
    params: params ?? {},
    severity: spec.severity ?? "error",
  });
}

/**
 * Throws a refusal unless the condition holds.
 *
 * @param condition What the request needs
 * @param spec The refusal it answers otherwise, from {@link REFUSALS}
 * @param params The values its sentence names
 */
export function refuse<S extends RefusalSpec>(
  condition: unknown,
  spec: S,
  ...params: ParamsArg<S>
): asserts condition {
  if (!condition) throw refusal(spec, ...params);
}

/**
 * A diagnostic of the query console's run and dry-run routes: the console shows its message
 * verbatim in its result pane, where the database's own error text also lands.
 *
 * @param message What failed
 * @param durationMs How long the run took, when it ran
 * @returns The result to throw
 */
export function queryDiagnostic(
  message: string,
  durationMs?: number,
): HTTPResult {
  return new HTTPResult(
    400,
    durationMs === undefined ? message : { message, durationMs },
  );
}
