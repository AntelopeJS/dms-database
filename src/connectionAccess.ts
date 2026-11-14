import {
  type ConnectionAccess,
  RegisterConnectionAccessSource,
} from "@antelopejs/interface-dms/connection-access";
import { getModuleConfig } from "./config";

const SOURCE_ID = "dms-database";

/**
 * The access `config.externalConnections` gives a connection: `"read-write"` only when its entry
 * says so, `"read"` for any other entry, and nothing for a connection it does not list.
 */
function configuredAccess(connection: string): ConnectionAccess | undefined {
  const connections = getModuleConfig().externalConnections ?? {};
  if (!Object.hasOwn(connections, connection)) {
    return undefined;
  }
  return connections[connection]?.access === "read-write"
    ? "read-write"
    : "read";
}

/** Answers the DMS's access checks on external connections from the module's configuration. */
export function registerConnectionAccess(): void {
  RegisterConnectionAccessSource(SOURCE_ID, configuredAccess);
}
