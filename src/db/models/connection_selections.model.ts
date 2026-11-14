import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  ConnectionSelection,
  connectionSelectionsTableName,
} from "../tables/connection_selections.table";

export class ConnectionSelectionModel extends BasicDataModel(
  ConnectionSelection,
  connectionSelectionsTableName,
) {
  /** The connection a user last picked, if any. */
  async selectedBy(userId: string): Promise<string | undefined> {
    return (await this.get(userId))?.connection;
  }

  /** Records the connection a user picks, creating the row on first use. */
  async select(userId: string, connection: string): Promise<void> {
    await this.table
      .insert(
        { _id: userId, connection, updatedAt: new Date() },
        { conflict: "update" },
      )
      .run();
  }
}
