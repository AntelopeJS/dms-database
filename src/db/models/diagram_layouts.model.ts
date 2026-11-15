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

  /** Writes the layout of a schema, over the row it already has. */
  async upsertForSchema(
    schemaName: string,
    positions: Record<string, Position>,
  ): Promise<void> {
    await this.table
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
  }
}
