import type {
  ActionType,
  JsonSchema,
} from "@antelopejs/interface-dms-automation";
import { OWN_CONNECTION } from "../service/database";
import type { Database } from "../service/database";
import {
  type ConnectionProbe,
  type ConnectionStatus,
  driverLabelOf,
  getStorageStats,
  probeConnection,
} from "../service/health";
import { resolveConnection } from "../service/rows";
import { asStep } from "./errors";
import {
  booleanInput,
  integerInput,
  stringInput,
  type NodeInput,
} from "./inputs";

const NAME_LENGTH = 128;
const DEFAULT_LARGEST_TABLES = 10;
const MAX_LARGEST_TABLES = 50;

type HealthOutput = {
  connection: string;
  status: ConnectionStatus;
  latencyMs: number | null;
  error: string | null;
  driver: string | null;
  checkedAt: string;
  schemaCount: number | null;
  tableCount: number | null;
  relationCount: number | null;
  indexCount: number | null;
  totalRows: number | null;
  largestTables: { schema: string; table: string; rows: number }[];
};

const COUNT_OR_NULL = { type: ["number", "null"] };

const INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    connection: {
      type: "string",
      title: "Connection",
      description: "`own` or an external connection id",
      default: OWN_CONNECTION,
      maxLength: NAME_LENGTH,
    },
    includeStats: {
      type: "boolean",
      title: "Include stats",
      description:
        "Also count schemas, tables and rows (one count per table, cached 30 s; a failed count reads as 0)",
      default: true,
    },
    largestTables: {
      type: "integer",
      title: "Largest tables",
      description: "Tables listed by row count, 0 to 50",
      default: DEFAULT_LARGEST_TABLES,
      minimum: 0,
      maximum: MAX_LARGEST_TABLES,
    },
  },
};

const OUTPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    connection: { type: "string" },
    status: { type: "string", enum: ["ok", "down"] },
    latencyMs: COUNT_OR_NULL,
    error: {
      type: ["string", "null"],
      description: "Why the probe failed; null when ok",
    },
    driver: {
      type: ["string", "null"],
      description:
        "Configured label (own) or catalog engine and version (external)",
    },
    checkedAt: { type: "string", format: "date-time" },
    schemaCount: COUNT_OR_NULL,
    tableCount: COUNT_OR_NULL,
    relationCount: COUNT_OR_NULL,
    indexCount: COUNT_OR_NULL,
    totalRows: {
      type: ["number", "null"],
      description: "Rows of every table in its default instance",
    },
    largestTables: {
      type: "array",
      items: {
        type: "object",
        properties: {
          schema: { type: "string" },
          table: { type: "string" },
          rows: { type: "number" },
        },
      },
      description: "Row counts, largest first; empty without stats",
    },
  },
  required: [
    "connection",
    "status",
    "latencyMs",
    "error",
    "driver",
    "checkedAt",
    "schemaCount",
    "tableCount",
    "relationCount",
    "indexCount",
    "totalRows",
    "largestTables",
  ],
};

/**
 * Builds the health action on a probe, which a test replaces.
 *
 * @param probe Probes the database
 * @returns The action type
 */
export function createHealthAction(
  probe: (db: Database) => Promise<ConnectionProbe> = probeConnection,
): ActionType<NodeInput, HealthOutput> {
  return {
    id: "database.health",
    name: "Database health",
    description:
      "Probes a database connection and reports its status, latency and size in tables and rows",
    icon: "i-ph-heartbeat",
    sideEffects: false,
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA,
    execute(input) {
      return asStep(async () => {
        const connection = stringInput(input, "connection", {
          max: NAME_LENGTH,
          fallback: OWN_CONNECTION,
        });
        const includeStats = booleanInput(input, "includeStats", true);
        const largest = integerInput(input, "largestTables", {
          fallback: DEFAULT_LARGEST_TABLES,
          min: 0,
          max: MAX_LARGEST_TABLES,
        });
        const db = await resolveConnection(connection);
        const checkedAt = new Date().toISOString();
        const answer = await probe(db);
        const stats = includeStats ? await getStorageStats(db) : undefined;
        const driver = await driverLabelOf(db);
        return {
          connection,
          status: answer.status,
          latencyMs: answer.latencyMs,
          error: answer.error,
          driver,
          checkedAt,
          schemaCount: stats?.schemaCount ?? null,
          tableCount: stats?.tableCount ?? null,
          relationCount: stats?.relationCount ?? null,
          indexCount: stats?.indexCount ?? null,
          totalRows: stats?.totalRows ?? null,
          largestTables: stats ? stats.storage.slice(0, largest) : [],
        };
      });
    },
  };
}

export const healthAction = createHealthAction();
