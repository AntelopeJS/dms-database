import type { Class } from "@antelopejs/interface-core/decorators";
import type { Schema } from "@antelopejs/interface-database";
import {
  DatumStaticMetadata,
  getMetadata,
  getTablesForSchema,
  ModifiersStaticMetadata,
  RelationStaticMetadata,
  type Table,
} from "@antelopejs/interface-database-decorators";
import { isObject } from "../utils/guards";
import { type FieldDescriptor, toFieldDescriptor } from "./fieldDescriptor";
import { getRegistry } from "./schemaRegistry";

const DESIGN_TYPE_DESCRIPTORS = new Map<unknown, () => FieldDescriptor>([
  [String, () => ({ kind: "string" })],
  [Number, () => ({ kind: "number" })],
  [Boolean, () => ({ kind: "boolean" })],
  [Date, () => ({ kind: "date" })],
  [Array, () => ({ kind: "array" })],
]);

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
    const descriptor = designTypeOf(TableClass, name);
    if (descriptor) types[name] = descriptor;
  }

  return { ordered, types };
}

/**
 * The design type TypeScript emitted for a decorated field, when it maps to a
 * descriptor: any decorator emits it, including those that leave no other
 * metadata (`@CreationTime`, `@UpdateTime`).
 */
function designTypeOf(
  TableClass: Class<Table>,
  name: string,
): FieldDescriptor | undefined {
  const prototype: unknown = TableClass.prototype;
  if (!isObject(prototype)) return undefined;
  return DESIGN_TYPE_DESCRIPTORS.get(
    Reflect.getMetadata("design:type", prototype, name),
  )?.();
}

export type SchemaTableDefinition = Schema["definition"][string];

export function decoratedFieldsOf(TableClass?: Class<Table>): DeclaredFields {
  return TableClass
    ? collectDecoratedFields(TableClass)
    : { ordered: [], types: {} };
}

/** Each field's definition type, else its decorated design type. */
export function declaredFieldTypes(
  def: SchemaTableDefinition,
  declared: DeclaredFields,
): Map<string, FieldDescriptor> {
  const types = new Map<string, FieldDescriptor>();
  for (const [name, value] of Object.entries(def.fields ?? {})) {
    types.set(name, toFieldDescriptor(value));
  }
  for (const [name, descriptor] of Object.entries(declared.types)) {
    if (!types.has(name)) types.set(name, descriptor);
  }
  return types;
}

/**
 * The declared type of each of `columns` as a table stores it, from its
 * definition, else the design type of its decorated field. A field behind a
 * two-way modifier (one that can `unlock`, as the decorators library tells
 * them) stores its locked value, an encrypted triple or a per-locale object,
 * and is left out.
 */
export function getDeclaredFieldTypes(
  schemaId: string,
  tableName: string,
  columns: readonly string[],
): Map<string, FieldDescriptor> {
  const def = getRegistry().get(schemaId)?.definition[tableName];
  if (!def) return new Map();
  const TableClass = getTablesForSchema(schemaId)?.[tableName];
  const types = declaredFieldTypes(def, decoratedFieldsOf(TableClass));
  if (!TableClass) return types;
  for (const column of columns) {
    const descriptor = types.has(column)
      ? undefined
      : designTypeOf(TableClass, column);
    if (descriptor) types.set(column, descriptor);
  }
  const modified = getMetadata(TableClass, ModifiersStaticMetadata, true);
  for (const [name, mods] of Object.entries(modified.fields ?? {})) {
    if (mods.some(({ modifier }) => "unlock" in modifier)) types.delete(name);
  }
  return types;
}
