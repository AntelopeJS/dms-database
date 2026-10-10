import { getModuleConfig } from "../config";
import { getTableElementCount, listSchemaSummaries } from "./introspect";
import { getRegistry } from "./schemaRegistry";

export type ConnectionStatus = "ok" | "down";

export interface StorageEntry {
  schema: string;
  table: string;
  /** Row count — used as a storage proxy when byte size is unavailable. */
  rows: number;
}

export interface OverviewHealth {
  /** Overall connection status, derived from a probe query. */
  status: ConnectionStatus;
  /** Round-trip latency of the probe query, in milliseconds. */
  latencyMs: number | null;
  /**
   * Display label for the driver. Not introspectable through
   * interface-database; sourced from module config (`driverLabel`).
   */
  driver: string | null;
  /** When the probe ran, as an ISO date. */
  checkedAt: string;
  /** What the failed probe threw; null while the connection is up. */
  error: string | null;
  /** Number of registered schemas. */
  schemaCount: number;
  /** Total tables across all schemas. */
  tableCount: number;
  /** Total declared relations across all tables. */
  relationCount: number;
  /** Total declared indexes across all tables. */
  indexCount: number;
  /** Total rows across all tables. */
  totalRows: number;
  /** Per-table storage proxy (row counts), sorted descending. */
  storage: StorageEntry[];
}

interface ConnectionProbe {
  status: ConnectionStatus;
  latencyMs: number | null;
  error: string | null;
}

interface StorageAggregate {
  tableCount: number;
  relationCount: number;
  indexCount: number;
  totalRows: number;
  storage: StorageEntry[];
}

// Lightweight connection probe: time listing instances of the first registered
// schema. No schema registered -> "ok" with unknown latency.
async function probeConnection(): Promise<ConnectionProbe> {
  const registry = getRegistry();
  const schemaIds = Array.from(registry.keys());
  const probeSchema = schemaIds[0] ? registry.get(schemaIds[0]) : undefined;
  if (!probeSchema) return { status: "ok", latencyMs: null, error: null };
  const startedAt = Date.now();
  try {
    await probeSchema.listInstances().run();
    return { status: "ok", latencyMs: Date.now() - startedAt, error: null };
  } catch (error) {
    return {
      status: "down",
      latencyMs: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Roll up table/index/row totals and the per-table storage proxy (row counts,
// sorted descending) from the introspected schema summaries.
async function aggregateStorage(
  summaries: Awaited<ReturnType<typeof listSchemaSummaries>>,
): Promise<StorageAggregate> {
  let tableCount = 0;
  let indexCount = 0;
  let relationCount = 0;
  let totalRows = 0;
  const storage: StorageEntry[] = [];

  for (const summary of summaries) {
    tableCount += summary.tables.length;
    const counts = await Promise.all(
      summary.tables.map((table) =>
        getTableElementCount(summary.id, table.name),
      ),
    );
    summary.tables.forEach((table, idx) => {
      const rows = counts[idx] ?? 0;
      totalRows += rows;
      indexCount += Object.keys(table.indexes ?? {}).length;
      relationCount += table.relations.length;
      storage.push({ schema: summary.id, table: table.name, rows });
    });
  }

  storage.sort((a, b) => b.rows - a.rows);
  return { tableCount, relationCount, indexCount, totalRows, storage };
}

/**
 * Probes the database connection and aggregates overview statistics.
 *
 * Status/latency come from a lightweight probe (listing instances of the first
 * registered schema). The driver name is not exposed by the interface-database
 * abstraction and comes from the module config; byte-size storage is not
 * available either, so row counts stand in for it.
 */
export async function getOverviewHealth(): Promise<OverviewHealth> {
  const checkedAt = new Date().toISOString();
  const { status, latencyMs, error } = await probeConnection();
  const summaries = await listSchemaSummaries();
  const aggregate = await aggregateStorage(summaries);

  return {
    status,
    latencyMs,
    driver: getModuleConfig().driverLabel ?? null,
    checkedAt,
    error,
    schemaCount: summaries.length,
    ...aggregate,
  };
}
