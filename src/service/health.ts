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
  /**
   * Connection pool usage ("used / total"). Not exposed by the
   * interface-database abstraction, so always null for now.
   */
  pool: string | null;
  /** Number of collections/tables across all registered schemas. */
  collections: number;
  /** Number of registered schemas. */
  schemaCount: number;
  /** Total tables across all schemas (== collections). */
  tableCount: number;
  /** Total declared indexes across all tables. */
  indexCount: number;
  /** Total rows across all tables. */
  totalRows: number;
  /**
   * Total stored bytes. Not available through interface-database, so always
   * null; the UI labels row counts as the storage proxy instead.
   */
  sizeBytes: number | null;
  /** Per-table storage proxy (row counts), sorted descending. */
  storage: StorageEntry[];
}

interface ConnectionProbe {
  status: ConnectionStatus;
  latencyMs: number | null;
}

interface StorageAggregate {
  tableCount: number;
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
  if (!probeSchema) return { status: "ok", latencyMs: null };
  const startedAt = Date.now();
  try {
    await probeSchema.listInstances().run();
    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch {
    return { status: "down", latencyMs: null };
  }
}

// Roll up table/index/row totals and the per-table storage proxy (row counts,
// sorted descending) from the introspected schema summaries.
async function aggregateStorage(
  summaries: Awaited<ReturnType<typeof listSchemaSummaries>>,
): Promise<StorageAggregate> {
  let tableCount = 0;
  let indexCount = 0;
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
      storage.push({ schema: summary.id, table: table.name, rows });
    });
  }

  storage.sort((a, b) => b.rows - a.rows);
  return { tableCount, indexCount, totalRows, storage };
}

/**
 * Probes the database connection and aggregates overview statistics.
 *
 * Status/latency come from a lightweight probe (listing instances of the first
 * registered schema). Driver name and pool stats are not exposed by the
 * interface-database abstraction; byte-size storage is likewise unavailable, so
 * row counts stand in as the storage proxy. These limitations are surfaced
 * explicitly (null fields) rather than faked.
 */
export async function getOverviewHealth(): Promise<OverviewHealth> {
  const { status, latencyMs } = await probeConnection();
  const summaries = await listSchemaSummaries();
  const { tableCount, indexCount, totalRows, storage } =
    await aggregateStorage(summaries);

  return {
    status,
    latencyMs,
    driver: getModuleConfig().driverLabel ?? null,
    pool: null,
    collections: tableCount,
    schemaCount: summaries.length,
    tableCount,
    indexCount,
    totalRows,
    sizeBytes: null,
    storage,
  };
}
