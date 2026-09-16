import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  SavedQueryRow,
  savedQueriesTableName,
} from "../tables/saved_queries.table";

export class SavedQueryModel extends BasicDataModel(
  SavedQueryRow,
  savedQueriesTableName,
) {
  async listForUser(userId: string): Promise<SavedQueryRow[]> {
    return this.table
      .filter((d) => d.key("userId").eq(userId))
      .orderBy("createdAt", "desc")
      .run();
  }

  async listShared(): Promise<SavedQueryRow[]> {
    return this.table
      .filter((d) => d.key("shared").eq(true))
      .orderBy("createdAt", "desc")
      .run();
  }
}
