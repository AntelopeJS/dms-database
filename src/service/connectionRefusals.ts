import { HTTPResult } from "@antelopejs/interface-api";

/**
 * The translation keys the database switcher, the access switch, the Data browser's edits and
 * the relation routes answer a refusal with. The dashboard's error presenter shows a refusal only
 * through a key its locales hold.
 */
export const CONNECTION_REFUSALS = {
  unknownConnection: "$dms_database.connections.unknown",
  notDevelopment: "$dms_database.connections.access.not_development",
  readOnlyAccount: "$dms_database.connections.access.account_read_only",
  unverifiedAccount: "$dms_database.connections.access.account_unverified",
  noModuleEntry: "$dms_database.connections.access.no_module_entry",
  noBuilder: "$dms_database.connections.access.no_builder",
  builderRefused: "$dms_database.connections.access.refused",
  catalogTimedOut: "$dms_database.connections.catalog.timed_out",
  catalogRefused: "$dms_database.connections.catalog.refused",
  staleDatabase: "$dms_database.data.save.database_changed",
  readOnlyConnection: "$dms_database.data.save.read_only_access",
} as const;

type RefusalKey =
  (typeof CONNECTION_REFUSALS)[keyof typeof CONNECTION_REFUSALS];

/**
 * A refusal whose sentence names a connection, as the dashboard's error presenter reads it.
 *
 * @param status The HTTP status
 * @param message The refusal's key
 * @param connection The connection the sentence names
 * @param severity How the toast shows it
 * @returns The result to throw
 */
export function connectionRefusal(
  status: number,
  message: RefusalKey,
  connection: string,
  severity: "warning" | "error" = "error",
): HTTPResult {
  return new HTTPResult(status, {
    message,
    params: { connection },
    severity,
  });
}
