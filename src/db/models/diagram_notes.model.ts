import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { OWN_CONNECTION } from "../../types/constants";
import {
  DiagramNote,
  diagramNotesTableName,
} from "../tables/diagram_notes.table";

/**
 * The connection a note belongs to: a note written before external databases
 * had a diagram names none and belongs to the project's own database.
 */
export function noteConnection(note: Pick<DiagramNote, "connection">): string {
  return note.connection ?? OWN_CONNECTION;
}

export class DiagramNoteModel extends BasicDataModel(
  DiagramNote,
  diagramNotesTableName,
) {
  /** The notes on one schema's diagram of one database, oldest first. */
  async listFor(
    connection: string,
    schemaName: string,
  ): Promise<DiagramNote[]> {
    return this.table
      .filter((d) =>
        d
          .key("schemaName")
          .eq(schemaName)
          .and(d.key("connection").default(OWN_CONNECTION).eq(connection)),
      )
      .orderBy("createdAt", "asc")
      .run();
  }
}
