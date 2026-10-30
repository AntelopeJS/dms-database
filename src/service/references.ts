import { type InstanceId, Schema } from "@antelopejs/interface-database";
import { listSchemaSummaries } from "./introspect";
import type { RelationDeclaration } from "./types";

/** Rows of one table pointing at a row through one relation column. */
export interface RowReference {
  schema: string;
  table: string;
  field: string;
  many: boolean;
  count: number;
}

interface InboundRelation extends RelationDeclaration {
  fromSchema: string;
  fromTable: string;
}

interface CountInput {
  relation: InboundRelation;
  value: unknown;
  instance: InstanceId | undefined;
}

async function listInboundRelations(
  schema: string,
  table: string,
): Promise<InboundRelation[]> {
  const summaries = await listSchemaSummaries();
  return summaries.flatMap((summary) =>
    summary.tables.flatMap((candidate) =>
      candidate.relations
        .filter(
          (relation) =>
            relation.toSchema === schema && relation.toTable === table,
        )
        .map((relation) => ({
          ...relation,
          fromSchema: summary.id,
          fromTable: candidate.name,
        })),
    ),
  );
}

/**
 * A table of another schema has no instance of this one: it is read in its
 * default instance.
 */
async function countReferences({
  relation,
  value,
  instance,
}: CountInput): Promise<number> {
  const source = Schema.get(relation.fromSchema);
  if (!source) return 0;
  const scope =
    relation.fromSchema === relation.toSchema ? instance : undefined;
  const rows = source.instance(scope).table(relation.fromTable);
  try {
    return await rows
      .filter((row) => {
        const field = row.key(relation.fromField);
        return relation.many ? field.includes(value) : field.eq(value);
      })
      .count();
  } catch {
    return 0;
  }
}

/**
 * How many rows of every table declaring a relation to `schema.table` point
 * at the given row, one entry per relation column.
 */
export async function listRowReferences(
  schema: string,
  table: string,
  row: Record<string, unknown>,
  instance: InstanceId | undefined,
): Promise<RowReference[]> {
  const relations = await listInboundRelations(schema, table);
  return Promise.all(
    relations.map(async (relation) => ({
      schema: relation.fromSchema,
      table: relation.fromTable,
      field: relation.fromField,
      many: relation.many,
      count: await countReferences({
        relation,
        value: Object.hasOwn(row, relation.toField)
          ? row[relation.toField]
          : undefined,
        instance,
      }),
    })),
  );
}
