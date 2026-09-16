import { Logging } from "@antelopejs/interface-core/logging";
import type { InstanceId, Schema } from "@antelopejs/interface-database";
import {
  DatumStaticMetadata,
  getMetadata,
  getTablesForSchema,
  ModifiersStaticMetadata,
  RelationStaticMetadata,
  type Table,
} from "@antelopejs/interface-database-decorators";
import { getModuleConfig } from "../config";
import { type FieldDescriptor, toFieldDescriptor } from "./fieldDescriptor";
import { resolveSchemaLabel } from "./schemaLabels";
import { getRegistry } from "./schemaRegistry";
import type {
  RelationDeclaration,
  SchemaStats,
  SchemaSummary,
  SchemaSummaryWithStats,
  TableSummary,
} from "./types";

const STATS_TTL_MS = 30_000;
const FIELDS_TTL_MS = 30_000;
const FIELD_INFERENCE_SAMPLE_SIZE = 5;
const UNKNOWN_DESCRIPTOR: FieldDescriptor = { kind: "unknown" };

const warnedRelations = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedRelations.has(key)) return;
  warnedRelations.add(key);
  Logging.Warn(`[dms-database] ${message}`);
}

function resolveRelations(
  schemaId: string,
  tableName: string,
  TableClass: typeof Table,
): RelationDeclaration[] {
  const meta = getMetadata(TableClass, RelationStaticMetadata, true);
  const out: RelationDeclaration[] = [];
  for (const [fromField, options] of Object.entries(meta.relations)) {
    const warnKey = `${schemaId}::${tableName}::${fromField}`;
    let TargetClass: typeof Table;
    try {
      TargetClass = options.to();
    } catch (err) {
      warnOnce(
        warnKey,
        `relation ${warnKey} target thunk threw: ${(err as Error).message}`,
      );
      continue;
    }
    if (typeof TargetClass !== "function") {
      warnOnce(warnKey, `relation ${warnKey} target is not a class`);
      continue;
    }
    const targetMeta = getMetadata(TargetClass, DatumStaticMetadata, true);
    if (!targetMeta.schemaName || !targetMeta.tableName) {
      warnOnce(warnKey, `relation ${warnKey} target lacks @RegisterTable`);
      continue;
    }
    out.push({
      fromField,
      toSchema: targetMeta.schemaName,
      toTable: targetMeta.tableName,
      toField: options.toField ?? targetMeta.primary,
      many: !!options.many,
    });
  }
  return out;
}

function resolveModifiers(
  TableClass: typeof Table | undefined,
): Record<string, string[]> {
  if (!TableClass) return {};
  const meta = getMetadata(TableClass, ModifiersStaticMetadata, true);
  const out: Record<string, string[]> = {};
  for (const [fieldName, mods] of Object.entries(meta.fields ?? {})) {
    if (!mods || mods.length === 0) continue;
    out[fieldName] = mods.map((m) => m.id);
  }
  return out;
}

interface CachedFields {
  value: Record<string, FieldDescriptor>;
  expiresAt: number;
}

const fieldsCache = new Map<string, CachedFields>();

function inferFieldType(value: unknown): FieldDescriptor | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return { kind: "date" };
  if (Array.isArray(value)) return { kind: "array" };
  if (typeof value === "object") return { kind: "object", fields: {} };
  if (typeof value === "string") return { kind: "string" };
  if (typeof value === "number") return { kind: "number" };
  if (typeof value === "boolean") return { kind: "boolean" };
  return undefined;
}

async function inferTableFields(
  schemaId: string,
  schema: Schema,
  tableName: string,
): Promise<Record<string, FieldDescriptor>> {
  const cacheKey = `${schemaId}::${tableName}`;
  const cached = fieldsCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const inferred: Record<string, FieldDescriptor> = {};
  try {
    const sample = await schema
      .instance()
      .table(tableName as never)
      .slice(0, FIELD_INFERENCE_SAMPLE_SIZE);
    for (const row of sample) {
      if (!row || typeof row !== "object") continue;
      for (const [key, value] of Object.entries(
        row as Record<string, unknown>,
      )) {
        if (key in inferred) continue;
        const type = inferFieldType(value);
        if (type !== undefined) inferred[key] = type;
      }
    }
  } catch {
    // Inference is best-effort; fall back to empty on any failure.
  }

  fieldsCache.set(cacheKey, {
    value: inferred,
    expiresAt: now + FIELDS_TTL_MS,
  });
  return inferred;
}

function mapDesignType(ctor: unknown): FieldDescriptor | undefined {
  if (ctor === String) return { kind: "string" };
  if (ctor === Number) return { kind: "number" };
  if (ctor === Boolean) return { kind: "boolean" };
  if (ctor === Date) return { kind: "date" };
  if (ctor === Array) return { kind: "array" };
  return undefined;
}

interface DeclaredFields {
  ordered: string[];
  types: Record<string, FieldDescriptor>;
}

function collectDecoratedFields(TableClass: typeof Table): DeclaredFields {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    ordered.push(name);
  };

  // 1. Class-field emit: names visible on an instance via Object.keys.
  try {
    const instance = new (TableClass as new () => object)();
    for (const name of Object.keys(instance)) push(name);
  } catch {
    // Constructor threw — skip class-field emit discovery.
  }

  // 2. Primary key.
  const datumMeta = getMetadata(TableClass, DatumStaticMetadata, true);
  if (datumMeta.primary && !seen.has(datumMeta.primary)) {
    seen.add(datumMeta.primary);
    ordered.unshift(datumMeta.primary);
  }

  // 3. Indexed fields (flatten groups; insertion order preserves @Index source order).
  for (const fields of Object.values(datumMeta.indexes)) {
    for (const name of fields) push(name);
  }

  // 4. Relation fields.
  const relationMeta = getMetadata(TableClass, RelationStaticMetadata, true);
  for (const name of Object.keys(relationMeta.relations)) push(name);

  // 5. Modifier fields.
  const modifierMeta = getMetadata(TableClass, ModifiersStaticMetadata, true);
  for (const name of Object.keys(modifierMeta.fields ?? {})) push(name);

  const types: Record<string, FieldDescriptor> = {};
  for (const name of ordered) {
    const ctor = Reflect.getMetadata("design:type", TableClass.prototype, name);
    const mapped = mapDesignType(ctor);
    if (mapped !== undefined) types[name] = mapped;
  }

  return { ordered, types };
}

type SchemaTableDefinition = Schema["definition"][string];

async function summarizeTable(
  id: string,
  schema: Schema,
  tableName: string,
  def: SchemaTableDefinition,
  tableClasses: ReturnType<typeof getTablesForSchema>,
): Promise<TableSummary> {
  const TableClass = tableClasses?.[tableName] as typeof Table | undefined;
  const relations = TableClass
    ? resolveRelations(id, tableName, TableClass)
    : [];
  const declared = TableClass
    ? collectDecoratedFields(TableClass)
    : { ordered: [], types: {} };
  const sampled = await inferTableFields(id, schema, tableName);
  const modifiers = resolveModifiers(TableClass);

  const definitionFields = (def.fields ?? {}) as Record<string, unknown>;
  const fromDefinition: Record<string, FieldDescriptor> = {};
  for (const [name, value] of Object.entries(definitionFields)) {
    fromDefinition[name] = toFieldDescriptor(value);
  }

  const fields: Record<string, FieldDescriptor> = {};
  for (const name of declared.ordered) {
    fields[name] =
      fromDefinition[name] ??
      declared.types[name] ??
      sampled[name] ??
      UNKNOWN_DESCRIPTOR;
  }
  for (const [name, descriptor] of Object.entries(fromDefinition)) {
    if (!(name in fields)) fields[name] = descriptor;
  }
  for (const [name, descriptor] of Object.entries(sampled)) {
    if (!(name in fields)) fields[name] = descriptor;
  }
  for (const name of Object.keys(modifiers)) {
    if (!(name in fields)) fields[name] = UNKNOWN_DESCRIPTOR;
  }

  return {
    name: tableName,
    fields,
    indexes: def.indexes,
    relations,
    modifiers,
  };
}

async function summarizeSchema(
  id: string,
  schema: Schema,
): Promise<SchemaSummary> {
  const tableClasses = getTablesForSchema(id);
  const tables: TableSummary[] = await Promise.all(
    Object.entries(schema.definition).map(([tableName, def]) =>
      summarizeTable(id, schema, tableName, def, tableClasses),
    ),
  );
  return { id, options: {}, tables };
}

export async function listSchemaSummaries(): Promise<SchemaSummary[]> {
  const entries = Array.from(getRegistry().entries());
  return Promise.all(
    entries.map(([id, schema]) => summarizeSchema(id, schema)),
  );
}

const tableCountCache = new Map<string, { value: number; expiresAt: number }>();

function tableCountKey(
  schemaId: string,
  tableName: string,
  instance?: InstanceId,
): string {
  // String() also handles the CROSS_INSTANCE symbol.
  return `${schemaId}::${String(instance ?? "")}::${tableName}`;
}

async function countTableRows(
  schema: Schema,
  tableName: string,
  instance?: InstanceId,
): Promise<number> {
  try {
    const table = schema.instance(instance).table(tableName as never);
    const total = await table.count();
    return typeof total === "number" && Number.isFinite(total) ? total : 0;
  } catch {
    return 0;
  }
}

async function listSchemaInstances(schema: Schema): Promise<string[]> {
  try {
    const named = await schema.listInstances().run();
    if (!Array.isArray(named)) return [];
    return named.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

export async function getTableElementCount(
  schemaId: string,
  tableName: string,
  instance?: InstanceId,
): Promise<number> {
  const key = tableCountKey(schemaId, tableName, instance);
  const cached = tableCountCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const schema = getRegistry().get(schemaId);
  if (!schema) return 0;
  const value = await countTableRows(schema, tableName, instance);
  tableCountCache.set(key, { value, expiresAt: now + STATS_TTL_MS });
  return value;
}

interface SchemaInsights {
  stats: SchemaStats;
  instances: string[];
}

async function computeInsights(
  id: string,
  schema: Schema,
): Promise<SchemaInsights> {
  const tableNames = Object.keys(schema.definition);
  const [counts, instances] = await Promise.all([
    Promise.all(tableNames.map((name) => getTableElementCount(id, name))),
    listSchemaInstances(schema),
  ]);
  return {
    stats: {
      tableCount: tableNames.length,
      elementCount: counts.reduce((sum, n) => sum + n, 0),
      instanceCount: 1 + instances.length,
    },
    instances,
  };
}

interface CachedInsights {
  value: SchemaInsights;
  expiresAt: number;
}

const insightsCache = new Map<string, CachedInsights>();

async function getInsights(
  id: string,
  schema: Schema,
): Promise<SchemaInsights> {
  const cached = insightsCache.get(id);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const insights = await computeInsights(id, schema);
  insightsCache.set(id, { value: insights, expiresAt: now + STATS_TTL_MS });
  return insights;
}

export async function listSchemaSummariesWithStats(): Promise<
  SchemaSummaryWithStats[]
> {
  const overrides = getModuleConfig().schemaLabels;
  const entries = Array.from(getRegistry().entries());
  const summaries = await Promise.all(
    entries.map(async ([id, schema]) => {
      const [base, insights] = await Promise.all([
        summarizeSchema(id, schema),
        getInsights(id, schema),
      ]);
      const label = resolveSchemaLabel(id, overrides);
      return {
        ...base,
        label,
        stats: insights.stats,
        instances: insights.instances,
      };
    }),
  );
  return summaries;
}

// Primary key field name for a registered table, resolved from the decorated
// table class metadata (e.g. "_id" on MongoDB). Used by the data browser to
// target a single row for inline edits. Returns undefined when the table has no
// decorated class or no declared primary key.
export function getTablePrimaryKey(
  schemaId: string,
  tableName: string,
): string | undefined {
  const tableClasses = getTablesForSchema(schemaId);
  const TableClass = tableClasses?.[tableName] as typeof Table | undefined;
  if (!TableClass) return undefined;
  const meta = getMetadata(TableClass, DatumStaticMetadata, true);
  return meta.primary || undefined;
}
