import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  DiagramNote,
  diagramNotesTableName,
} from "../tables/diagram_notes.table";

export class DiagramNoteModel extends BasicDataModel(
  DiagramNote,
  diagramNotesTableName,
) {
  async listBySchema(schemaName: string): Promise<DiagramNote[]> {
    return this.table
      .filter((d) => d.key("schemaName").eq(schemaName))
      .orderBy("createdAt", "asc")
      .run();
  }
}
