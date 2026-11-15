import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { OWN_CONNECTION } from "../../types/constants";
import type { Position } from "../../types/responses";
import {
  DiagramLayout,
  diagramLayoutsTableName,
} from "../tables/diagram_layouts.table";

/**
 * The id of a schema's layout row. On the project's own database it is the
 * schema name, the id its rows had before external databases had a diagram;
 * on an external one it holds the connection too, so two databases with a
 * schema of the same name never share a layout.
 *
 * @param connection The connection of the schema's database
 * @param schemaName The schema
 * @returns The row id
 */
export function diagramLayoutId(
  connection: string,
  schemaName: string,
): string {
  return connection === OWN_CONNECTION
    ? schemaName
    : JSON.stringify([connection, schemaName]);
}

/** Keeps one layout row per schema of each database. */
export class DiagramLayoutModel extends BasicDataModel(
  DiagramLayout,
  diagramLayoutsTableName,
) {
  getFor(
    connection: string,
    schemaName: string,
  ): PromiseLike<DiagramLayout | undefined> {
    return this.get(diagramLayoutId(connection, schemaName));
  }

  /** Writes the layout of a schema, over the row it already has. */
  async upsertFor(
    connection: string,
    schemaName: string,
    positions: Record<string, Position>,
  ): Promise<void> {
    await this.table
      .insert(
        {
          _id: diagramLayoutId(connection, schemaName),
          schemaName,
          connection,
          positions: JSON.stringify(positions),
          updatedAt: new Date(),
        },
        { conflict: "update" },
      )
      .run();
  }
}
