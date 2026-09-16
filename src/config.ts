import type { SchemaLabelOverrides } from "./service/schemaLabels";

export interface DmsDatabaseConfig {
  schemaLabels?: SchemaLabelOverrides;
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
