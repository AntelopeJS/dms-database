import type { FieldDescriptor } from "./fieldDescriptor";

export type { FieldDescriptor };

/**
 * Resolved form of an upstream `@Relation` declaration
 * (see `@antelopejs/interface-database-decorators/relation`), as produced by
 * the schema introspection.
 */
export interface RelationDeclaration {
  fromField: string;
  toSchema: string;
  toTable: string;
  toField: string;
  many: boolean;
}

export interface IndexDefinition {
  fields?: string[];
  multi?: boolean;
}

export interface TableSummary {
  name: string;
  fields: Record<string, FieldDescriptor>;
  indexes: Record<string, IndexDefinition>;
  relations: RelationDeclaration[];
  modifiers: Record<string, string[]>;
}

export interface SchemaSummary {
  id: string;
  options: Record<string, never>;
  tables: TableSummary[];
}

export type SchemaLabelColor =
  | "primary"
  | "secondary"
  | "success"
  | "info"
  | "warning"
  | "error"
  | "neutral";

export interface SchemaLabel {
  text: string;
  color?: SchemaLabelColor;
}

export interface SchemaStats {
  tableCount: number;
  elementCount: number;
  instanceCount: number;
}

export interface SchemaSummaryWithStats extends SchemaSummary {
  label?: SchemaLabel;
  stats: SchemaStats;
  instances: string[];
}

export type QueryLanguage = "aql";

export interface SavedQuery {
  id: string;
  userId: string;
  name: string;
  description: string;
  query: Record<string, unknown>;
  source: string;
  language: QueryLanguage;
  shared: boolean;
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  userId: string;
  query: Record<string, unknown>;
  source: string;
  language: QueryLanguage;
  executedAt: string;
  durationMs: number;
  rowCount: number;
}

export interface ExecuteResult {
  rows: Record<string, unknown>[];
  executedAt: string;
  durationMs: number;
}
