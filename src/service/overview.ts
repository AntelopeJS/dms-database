import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ActivityFeedItem } from "@antelopejs/interface-dms/base/activity-feed";
import type { NavCardItem } from "@antelopejs/interface-dms/base/nav-card-grid";
import type { TopListItem } from "@antelopejs/interface-dms/base/top-list-card";
import type { Tone } from "@antelopejs/interface-dms/base/types/tone";
import { QueryHistoryModel, type QueryHistoryRow } from "../db";
import { formatCount, type LocaleCarrier, localeOf } from "../i18n/messages";
import { DATABASE_PATHS } from "../module";
import { OVERVIEW_FEED_LIMIT, SLOW_QUERY_MS } from "../types/constants";
import { getOverviewHealth } from "./health";
import { listSchemaSummariesWithStats } from "./introspect";
import type { QueryRunStatus, SchemaSummaryWithStats } from "./types";

const SEPARATOR = " · ";
const SCHEMA_ICON = "i-ph-stack";
const QUERY_ICON = "i-ph-code";

function tableLink(schema: string, table: string): string {
  const query = new URLSearchParams({ schema, table });
  return `${DATABASE_PATHS.data}?${query.toString()}`;
}

function schemaCard(
  summary: SchemaSummaryWithStats,
  user: LocaleCarrier,
): NavCardItem {
  const locale = localeOf(user);
  const relations = summary.tables.reduce(
    (sum, table) => sum + table.relations.length,
    0,
  );
  return {
    id: summary.id,
    title: summary.id,
    description: summary.label?.text,
    icon: SCHEMA_ICON,
    iconTone: summary.label?.color ?? "primary",
    to: `${DATABASE_PATHS.schemas}?${new URLSearchParams({ tab: `schema-${summary.id}` }).toString()}`,
    tag: formatCount(locale, "instances", summary.stats.instanceCount),
    readout: [
      [
        formatCount(locale, "tables", summary.stats.tableCount),
        formatCount(locale, "rows", summary.stats.elementCount),
      ].join(SEPARATOR),
      formatCount(locale, "relations", relations),
    ],
  };
}

/** One card per registered schema, largest first. */
export async function listSchemaCards(
  user: LocaleCarrier,
): Promise<NavCardItem[]> {
  const summaries = await listSchemaSummariesWithStats();
  return summaries
    .sort((left, right) => right.stats.elementCount - left.stats.elementCount)
    .map((summary) => schemaCard(summary, user));
}

/** The tables holding the most rows, across every schema. */
export async function listLargestTables(): Promise<TopListItem[]> {
  const { storage } = await getOverviewHealth();
  return storage.slice(0, OVERVIEW_FEED_LIMIT).map((entry) => ({
    id: `${entry.schema}::${entry.table}`,
    title: entry.table,
    description: entry.schema,
    value: entry.rows,
    icon: "i-ph-table",
    to: tableLink(entry.schema, entry.table),
  }));
}

// Rows written before runs recorded their status succeeded: only successful
// runs used to be stored.
export function runStatusOf(
  row: Pick<QueryHistoryRow, "status">,
): QueryRunStatus {
  return row.status ?? "ok";
}

const STATUS_TONES: Record<QueryRunStatus, Tone> = {
  ok: "success",
  error: "error",
};

function runTone(row: QueryHistoryRow): Tone {
  if (runStatusOf(row) === "error") return STATUS_TONES.error;
  if (row.mutation) return "info";
  return row.durationMs > SLOW_QUERY_MS ? "warning" : STATUS_TONES.ok;
}

function runMeta(row: QueryHistoryRow): string[] {
  if (runStatusOf(row) === "error") {
    return ["$dms_database.overview.recent.failed"];
  }
  return [
    "$dms_database.overview.recent.duration",
    row.mutation
      ? "$dms_database.overview.recent.changed"
      : "$dms_database.overview.recent.rows",
  ];
}

function recentQueryItem(
  row: QueryHistoryRow & { _id: string },
): ActivityFeedItem {
  const executedAt =
    row.executedAt instanceof Date ? row.executedAt : new Date(row.executedAt);
  return {
    id: row._id,
    icon: QUERY_ICON,
    tone: runTone(row),
    title: row.source,
    meta: runMeta(row),
    params: {
      duration: String(row.durationMs),
      count: String(row.rowCount),
    },
    date: executedAt.toISOString(),
    to: `${DATABASE_PATHS.query}?${new URLSearchParams({ history: row._id }).toString()}`,
  };
}

/** The caller's latest query runs, newest first. */
export async function listRecentQueries(
  userId: string,
): Promise<ActivityFeedItem[]> {
  const { items } = await GetModel(QueryHistoryModel).listForUser(
    userId,
    OVERVIEW_FEED_LIMIT,
    0,
  );
  return items.map((row) =>
    recentQueryItem(row as QueryHistoryRow & { _id: string }),
  );
}
