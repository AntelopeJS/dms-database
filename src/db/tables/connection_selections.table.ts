import {
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";

export const connectionSelectionsTableName = "connection_selections";

/** The database a user browses in the console, keyed by the user's id. */
@RegisterTable(connectionSelectionsTableName, SCHEMA_NAME)
export class ConnectionSelection extends Table {
  /** The connection id: `own`, or an external connection's. */
  @Field("string")
  declare connection: string;

  @Field("date")
  declare updatedAt: Date;
}
