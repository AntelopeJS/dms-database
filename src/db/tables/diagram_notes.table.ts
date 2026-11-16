import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";

export const diagramNotesTableName = "diagram_notes";

@RegisterTable(diagramNotesTableName, SCHEMA_NAME)
export class DiagramNote extends Table {
  @Index()
  @Field("string")
  declare schemaName: string;

  /**
   * The connection of the database the schema belongs to. Rows written before
   * external databases had a diagram have none: they belong to the project's
   * own database.
   */
  @Field("string")
  declare connection?: string;

  @Field("string")
  declare text: string;

  @Field("number")
  declare x: number;

  @Field("number")
  declare y: number;

  @Field("number")
  declare width: number;

  @Field("number")
  declare height: number;

  @Field("string")
  declare color?: string;

  @Field("date")
  declare createdAt: Date;

  @Field("date")
  declare updatedAt: Date;
}
