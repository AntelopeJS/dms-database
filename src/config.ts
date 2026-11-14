import type { ConnectionAccess } from "@antelopejs/interface-dms/connection-access";
import type { SchemaLabelOverrides } from "./service/schemaLabels";

/** What the DMS may do on an external connection whose tables it maps. */
export interface ExternalConnectionConfig {
  /**
   * `"read-write"` lets the generated routes of the connection's mapped tables write rows. Any
   * other value, or none, keeps them read-only: their writes answer 403.
   */
  access?: ConnectionAccess;
}

export interface DmsDatabaseConfig {
  schemaLabels?: SchemaLabelOverrides;
  /** The external connections the DMS maps tables from, keyed by connection id. */
  externalConnections?: Record<string, ExternalConnectionConfig>;
  /**
   * Display name of the underlying database driver shown on the overview
   * health hero (e.g. "MongoDB 6.0"). The driver cannot be introspected
   * through the @antelopejs/interface-database abstraction, so it is supplied
   * by configuration. When omitted the overview shows "—".
   */
  driverLabel?: string;
}

let moduleConfig: DmsDatabaseConfig = {};

export function setModuleConfig(config: DmsDatabaseConfig | undefined): void {
  moduleConfig = config ?? {};
}

export function getModuleConfig(): DmsDatabaseConfig {
  return moduleConfig;
}
