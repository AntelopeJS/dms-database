import type { Class } from "@antelopejs/interface-core/decorators";
import { Logging } from "@antelopejs/interface-core/logging";
import {
  CROSS_INSTANCE,
  type InstanceId,
  type Schema,
} from "@antelopejs/interface-database";
import {
  DatumStaticMetadata,
  getMetadata,
  getTablesForSchema,
  ModifiersStaticMetadata,
  RelationStaticMetadata,
  type Table,
} from "@antelopejs/interface-database-decorators";
import { getModuleConfig } from "../config";
import {
  isBoolean,
  isFiniteNumber,
  isFunction,
  isNumber,
  isObject,
  isString,
} from "../utils/guards";
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
const NULL_DESCRIPTOR: FieldDescriptor = { kind: "null" };

const warnedRelations = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedRelations.has(key)) return;
  warnedRelations.add(key);
  Logging.Warn(`[dms-database] ${message}`);
}

function resolveRelations(
  schemaId: string,
  tableName: string,
  TableClass: Class<Table>,
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
        `relation ${warnKey} target thunk threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (!isFunction(TargetClass)) {
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
  TableClass: Class<Table> | undefined,
): TableSummary["modifiers"] {
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

/**
 * An array's element type, from its elements other than `null`: one kind
 * gives `kind[]`, several a union of them, none leaves it untyped (D-20).
 */
function inferArrayType(items: unknown[]): FieldDescriptor {
  const members: FieldDescriptor[] = [];
  for (const item of items) {
    const type = inferFieldType(item);
    if (!type) continue;
    const key = JSON.stringify(type);
    if (!members.some((member) => JSON.stringify(member) === key))
      members.push(type);
  }
  if (members.length === 0) return { kind: "array" };
  const [only] = members;
  return {
    kind: "array",
    element: members.length === 1 && only ? only : { kind: "union", members },
  };
}

type ArrayDescriptor = Extract<FieldDescriptor, { kind: "array" }>;

/** The array in a descriptor, alone or as a member of a union with `null`. */
function arrayOf(descriptor?: FieldDescriptor): ArrayDescriptor | undefined {
  const members =
    descriptor?.kind === "union" ? descriptor.members : [descriptor];
  return members.find(
    (member): member is ArrayDescriptor => member?.kind === "array",
  );
}

/**
 * The type of a column seen in several rows: the first one, unless it is an
 * array of elements unknown so far (empty) that a later row tells.
 */
function refineSampled(seen?: FieldDescriptor, next?: FieldDescriptor) {
  const untyped = seen?.kind === "array" && !seen.element;
  return untyped && arrayOf(next)?.element ? next : (seen ?? next);
}

function inferFieldType(value: unknown): FieldDescriptor | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return { kind: "date" };
  if (Array.isArray(value)) return inferArrayType(value);
  if (isObject(value)) return { kind: "object", fields: {} };
  if (isString(value)) return { kind: "string" };
  if (isNumber(value)) return { kind: "number" };
  if (isBoolean(value)) return { kind: "boolean" };
  return undefined;
}

async function sampleRows(
  schema: Schema,
  tableName: string,
  instance?: string,
): Promise<unknown[]> {
  try {
    const rows: unknown[] = await schema
      .instance(instance)
      .table(tableName)
      .slice(0, FIELD_INFERENCE_SAMPLE_SIZE);
    return rows;
  } catch {
    return [];
  }
}

/**
 * The rows to infer a table's columns from: the default instance's, or, when
 * it holds none, the first named instance holding some. A schema whose data
 * lives in named instances (one per region, per tenant) otherwise shows only
 * its decorated columns.
 */
async function sampleAnyInstance(
  schema: Schema,
  tableName: string,
): Promise<unknown[]> {
  const rows = await sampleRows(schema, tableName);
  if (rows.length > 0) return rows;
  for (const instance of await listSchemaInstances(schema)) {
    const named = await sampleRows(schema, tableName, instance);
    if (named.length > 0) return named;
  }
  return [];
}

/**
 * The instance a row was read from, which the store adds to rows of named
 * instances: not a column of the table.
 */
const INSTANCE_TAG_FIELD = "_instance";

interface ObservedField {
  type?: FieldDescriptor;
  nullable: boolean;
}

/** Kinds that admit an empty value on their own. */
const NULLISH_KINDS = new Set<FieldDescriptor["kind"]>([
  "null",
  "undefined",
  "any",
  "unknown",
]);

function admitsNull(descriptor: FieldDescriptor): boolean {
  if (NULLISH_KINDS.has(descriptor.kind)) return true;
  return (
    descriptor.kind === "union" &&
    descriptor.members.some((member) => NULLISH_KINDS.has(member.kind))
  );
}

/** The descriptor, or a union of it with `null` when it does not admit one. */
function withNull(descriptor: FieldDescriptor): FieldDescriptor {
  if (admitsNull(descriptor)) return descriptor;
  if (descriptor.kind === "union")
    return { kind: "union", members: [...descriptor.members, NULL_DESCRIPTOR] };
  return { kind: "union", members: [descriptor, NULL_DESCRIPTOR] };
}

/**
 * A column holding `null` in some sampled rows is nullable: its type is a
 * union with `null`, and a column holding only `null` is typed `null`.
 */
function inferFromRows(rows: unknown[]): TableSummary["fields"] {
  const observed = new Map<string, ObservedField>();
  for (const row of rows) {
    if (!isObject(row)) continue;
    for (const [key, value] of Object.entries(row)) {
      if (key === INSTANCE_TAG_FIELD) continue;
      const field = observed.get(key) ?? { nullable: false };
      if (value === null) field.nullable = true;
      else field.type = refineSampled(field.type, inferFieldType(value));
      observed.set(key, field);
    }
  }
  const inferred: Record<string, FieldDescriptor> = {};
  for (const [key, { type, nullable }] of observed) {
    if (type) inferred[key] = nullable ? withNull(type) : type;
    else if (nullable) inferred[key] = NULL_DESCRIPTOR;
  }
  return inferred;
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

  const inferred = inferFromRows(await sampleAnyInstance(schema, tableName));
  fieldsCache.set(cacheKey, {
    value: inferred,
    expiresAt: now + FIELDS_TTL_MS,
  });
  return inferred;
}

function mapDesignType(
  ctor: (new (...args: never[]) => object) | undefined,
): FieldDescriptor | undefined {
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

/**
 * The decorated names of a table class, in discovery order: the instance's own
 * class fields (skipped when the constructor throws), the primary key first,
 * the indexed fields (insertion order preserves the `@Index` source order),
 * the relation fields, then the modifier fields.
 */
function collectDecoratedFields(TableClass: Class<Table>): DeclaredFields {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    ordered.push(name);
  };

  try {
    const instance = new TableClass();
    for (const name of Object.keys(instance)) push(name);
  } catch {}

  const datumMeta = getMetadata(TableClass, DatumStaticMetadata, true);
  if (datumMeta.primary && !seen.has(datumMeta.primary)) {
    seen.add(datumMeta.primary);
    ordered.unshift(datumMeta.primary);
  }

  for (const fields of Object.values(datumMeta.indexes)) {
    for (const name of fields) push(name);
  }

  const relationMeta = getMetadata(TableClass, RelationStaticMetadata, true);
  for (const name of Object.keys(relationMeta.relations)) push(name);

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

/**
 * A declared type says nothing of `null` (`string | null` reflects as
 * `Object`) nor of an array's elements (`string[]` reflects as `Array`): the
 * sampled rows tell both (D-20).
 */
async function summarizeTable(
  id: string,
  schema: Schema,
  tableName: string,
  def: SchemaTableDefinition,
  tableClasses: ReturnType<typeof getTablesForSchema>,
): Promise<TableSummary> {
  const TableClass = tableClasses?.[tableName];
  const relations = TableClass
    ? resolveRelations(id, tableName, TableClass)
    : [];
  const declared = TableClass
    ? collectDecoratedFields(TableClass)
    : { ordered: [], types: {} };
  const sampled = await inferTableFields(id, schema, tableName);
  const modifiers = resolveModifiers(TableClass);

  const definitionFields = def.fields ?? {};
  const fromDefinition: Record<string, FieldDescriptor> = {};
  for (const [name, value] of Object.entries(definitionFields)) {
    fromDefinition[name] = toFieldDescriptor(value);
  }

  const withSampled = (name: string, descriptor: FieldDescriptor) => {
    const seen = sampled[name];
    const element = arrayOf(seen)?.element;
    const typed: FieldDescriptor =
      descriptor.kind === "array" && !descriptor.element && element
        ? { kind: "array", element }
        : descriptor;
    return seen && admitsNull(seen) ? withNull(typed) : typed;
  };
  const fields: Record<string, FieldDescriptor> = {};
  for (const name of declared.ordered) {
    fields[name] = withSampled(
      name,
      fromDefinition[name] ??
        declared.types[name] ??
        sampled[name] ??
        UNKNOWN_DESCRIPTOR,
    );
  }
  for (const [name, descriptor] of Object.entries(fromDefinition)) {
    if (!(name in fields)) fields[name] = withSampled(name, descriptor);
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

/** `String()` also handles the `CROSS_INSTANCE` symbol. */
function tableCountKey(
  schemaId: string,
  tableName: string,
  instance?: InstanceId,
): string {
  return `${schemaId}::${String(instance ?? "")}::${tableName}`;
}

async function countTableRows(
  schema: Schema,
  tableName: string,
  instance?: InstanceId,
): Promise<number> {
  const table = schema.instance(instance).table(tableName);
  const total = await table.count();
  return isFiniteNumber(total) ? total : 0;
}

async function cachedCount(
  key: string,
  count: () => Promise<number>,
): Promise<number> {
  const cached = tableCountCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await count();
  tableCountCache.set(key, { value, expiresAt: now + STATS_TTL_MS });
  return value;
}

export async function listSchemaInstances(schema: Schema): Promise<string[]> {
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
  const schema = getRegistry().get(schemaId);
  if (!schema) return 0;
  return cachedCount(tableCountKey(schemaId, tableName, instance), () =>
    countTableRows(schema, tableName, instance).catch(() => 0),
  );
}

/** Rows of a table in every instance at once: one cross-instance count. */
export async function getTableTotalCount(
  schemaId: string,
  tableName: string,
): Promise<number> {
  const schema = getRegistry().get(schemaId);
  if (!schema) return 0;
  return cachedCount(tableCountKey(schemaId, tableName, CROSS_INSTANCE), () =>
    countTableRows(schema, tableName, CROSS_INSTANCE).catch(() => 0),
  );
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

/**
 * Primary key field name for a registered table, resolved from the decorated
 * table class metadata (e.g. "_id" on MongoDB). Used by the data browser to
 * target a single row for inline edits. Returns undefined when the table has no
 * decorated class or no declared primary key.
 */
export function getTablePrimaryKey(
  schemaId: string,
  tableName: string,
): string | undefined {
  const tableClasses = getTablesForSchema(schemaId);
  const TableClass = tableClasses?.[tableName];
  if (!TableClass) return undefined;
  const meta = getMetadata(TableClass, DatumStaticMetadata, true);
  return meta.primary || undefined;
}
