import { IsDuplicateKeyError } from "@antelopejs/interface-database";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import type { Position } from "../../types/responses";
import {
  DiagramLayout,
  diagramLayoutsTableName,
} from "../tables/diagram_layouts.table";

/** Keeps one layout row per schema, keyed by the schema name. */
export class DiagramLayoutModel extends BasicDataModel(
  DiagramLayout,
  diagramLayoutsTableName,
) {
  getBySchema(schemaName: string): PromiseLike<DiagramLayout | undefined> {
    return this.get(schemaName);
  }

  /**
   * Writes the layout of a schema. A save that loses the race to create the
   * row writes again, over the row the winner created.
   */
  async upsertForSchema(
    schemaName: string,
    positions: Record<string, Position>,
  ): Promise<void> {
    const write = () =>
      this.table
        .insert(
          {
            _id: schemaName,
            schemaName,
            positions: JSON.stringify(positions),
            updatedAt: new Date(),
          },
          { conflict: "update" },
        )
        .run();
    try {
      await write();
    } catch (error) {
      if (!IsDuplicateKeyError(error)) throw error;
      await write();
    }
  }
}
