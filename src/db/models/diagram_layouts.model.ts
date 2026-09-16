import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import type { Position } from "../../types/responses";
import {
  DiagramLayout,
  diagramLayoutsTableName,
} from "../tables/diagram_layouts.table";

export class DiagramLayoutModel extends BasicDataModel(
  DiagramLayout,
  diagramLayoutsTableName,
) {
  async getBySchema(schemaName: string): Promise<DiagramLayout | undefined> {
    const rows = await this.table
      .filter((d) => d.key("schemaName").eq(schemaName))
      .run();
    return rows[0];
  }

  async upsertForSchema(
    schemaName: string,
    positions: Record<string, Position>,
  ): Promise<void> {
    const existing = await this.getBySchema(schemaName);
    const payload = {
      schemaName,
      positions: JSON.stringify(positions),
      updatedAt: new Date(),
    };
    if (existing) {
      await this.update(existing._id, payload);
    } else {
      await this.insert(payload);
    }
  }
}
