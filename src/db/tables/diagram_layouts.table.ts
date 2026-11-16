import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";

export const diagramLayoutsTableName = "diagram_layouts";

@RegisterTable(diagramLayoutsTableName, SCHEMA_NAME)
export class DiagramLayout extends Table {
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

  /** JSON-stringified Record<tableName, { x: number; y: number }> */
  @Field("string")
  declare positions: string;

  @Field("date")
  declare updatedAt: Date;
}
