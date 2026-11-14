import { Logging } from "@antelopejs/interface-core/logging";
import { getModuleConfig } from "../config";
import { TIMED_OUT, withDeadline } from "../utils/deadline";
import { resolveCatalog } from "./connections";
import { type Database, OWN_CONNECTION } from "./database";
import { getTableElementCount, listSchemaSummaries } from "./introspect";

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

/** The longest the health probe waits, in milliseconds. */
const PROBE_DEADLINE_MS = 3_000;
const PROBE_OK = "ok";
const PROBE_REFUSED = "refused";

/**
 * Lightweight connection probe: time counting the rows of the first table of
 * the first schema that has one, in its default instance, which every
 * database offers. No table registered -> "ok" with unknown latency.
 */
async function probeConnection(db: Database): Promise<ConnectionProbe> {
  const probe = Array.from(db.schemas().values())
    .flatMap((schema) =>
      Object.keys(schema.definition).map((table) => ({ schema, table })),
    )
    .at(0);
  if (!probe) return { status: "ok", latencyMs: null, error: null };
  const startedAt = Date.now();
  const answer = await withDeadline(
    probe.schema
      .instance()
      .table(probe.table)
      .count()
      .run()
      .then(
        () => PROBE_OK,
        (error: unknown) => {
          Logging.Warn(
            `[dms-database] ${db.connection} refused the probe`,
            error,
          );
          return PROBE_REFUSED;
        },
      ),
    PROBE_DEADLINE_MS,
  );
  if (answer === PROBE_OK) {
    return { status: "ok", latencyMs: Date.now() - startedAt, error: null };
  }
  if (answer === TIMED_OUT) {
    Logging.Warn(
      `[dms-database] ${db.connection} did not answer the probe in time`,
    );
  }
  return {
    status: "down",
    latencyMs: null,
    error:
      answer === TIMED_OUT
        ? "The database did not answer in time"
        : "The database refused the probe: see the server log",
  };
}

/**
 * Roll up table/index/row totals and the per-table storage proxy (row counts,
 * sorted descending) from the introspected schema summaries.
 */
async function aggregateStorage(
  db: Database,
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
        getTableElementCount(db, summary.id, table.name),
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
 * The driver label a database shows: the configured one for the project's
 * own, the engine and version its catalog reports for an external one, or
 * `null` when the catalog does not answer.
 */
async function driverLabelOf(db: Database): Promise<string | null> {
  if (db.connection === OWN_CONNECTION) {
    return getModuleConfig().driverLabel ?? null;
  }
  const info = await resolveCatalog(db.connection)
    .Info()
    .catch(() => undefined);
  return info ? `${info.engine} ${info.version}` : null;
}

/**
 * Probes a database's connection and aggregates its overview statistics.
 *
 * Status/latency come from a lightweight probe (counting the first table's
 * rows in its default instance). Byte-size storage is not exposed by the
 * interface-database abstraction, so row counts stand in for it.
 */
export async function getOverviewHealth(db: Database): Promise<OverviewHealth> {
  const checkedAt = new Date().toISOString();
  const { status, latencyMs, error } = await probeConnection(db);
  const summaries = await listSchemaSummaries(db);
  const aggregate = await aggregateStorage(db, summaries);
  const driver = await driverLabelOf(db);

  return {
    status,
    latencyMs,
    driver,
    checkedAt,
    error,
    schemaCount: summaries.length,
    ...aggregate,
  };
}
