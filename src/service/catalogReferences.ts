import type {
  Reference,
  RelationDescription,
  RelationSummary,
} from "@antelopejs/interface-database-catalog";
import type { RelationDeclaration } from "./types";

/** The relation declarations of each table of a schema, by table name. */
export type RelationsByTable = Record<string, RelationDeclaration[]>;

function relationName({ schema, name }: RelationSummary): string {
  return `${schema}.${name}`;
}

/**
 * The foreign keys a catalog reports out of a schema's relations, as the
 * relation declarations the diagram draws: one per column of each key, its
 * target named by the schema and table the catalog lists it under. A key to a
 * relation the catalog does not list is left out, since its schema and table
 * cannot be told apart from the dotted name alone.
 *
 * @param described The schema's relations, as the catalog describes them
 * @param listed Every relation the catalog lists
 * @returns The declarations, by table
 */
export function referencesByTable(
  described: RelationDescription[],
  listed: RelationSummary[],
): RelationsByTable {
  const byName = new Map(
    listed.map((summary) => [relationName(summary), summary]),
  );
  const declarations = ({ from, to }: Reference): RelationDeclaration[] => {
    const target = byName.get(to.relation);
    if (!target) return [];
    return from.columns.flatMap((fromField, index) => {
      const toField = to.columns[index];
      if (toField === undefined) return [];
      return [
        {
          fromField,
          toSchema: target.schema,
          toTable: target.name,
          toField,
          many: false,
        },
      ];
    });
  };
  return Object.fromEntries(
    described.map((relation) => [
      relation.name,
      relation.references.flatMap(declarations),
    ]),
  );
}
