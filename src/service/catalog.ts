import type { ModuleReadoutLine } from "@antelopejs/interface-dms/page";
import {
  formatCount,
  formatMessage,
  type LocaleCarrier,
  localeOf,
} from "../i18n/messages";
import { getOverviewHealth } from "./health";

const SEPARATOR = " · ";

/**
 * The two lines of the module's catalog tile: what the database holds, then
 * how the connection answers.
 */
export async function readCatalogReadout(
  user: LocaleCarrier | undefined,
): Promise<ModuleReadoutLine[]> {
  const locale = localeOf(user);
  const health = await getOverviewHealth();
  if (health.status === "down") {
    return [{ text: formatMessage(locale, "connectionDown"), tone: "error" }];
  }
  const contents = [
    formatCount(locale, "tables", health.tableCount),
    formatCount(locale, "rows", health.totalRows),
  ].join(SEPARATOR);
  const connection = [formatCount(locale, "schemas", health.schemaCount)];
  if (health.latencyMs !== null) {
    connection.push(
      formatMessage(locale, "latency", { value: String(health.latencyMs) }),
    );
  }
  return [
    { text: contents, tone: "success" },
    { text: connection.join(SEPARATOR), tone: "info" },
  ];
}
