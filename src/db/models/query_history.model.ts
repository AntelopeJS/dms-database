import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { MAX_HISTORY_PER_USER } from "../../types/constants";
import type { PaginatedResult } from "../../types/responses";
import {
  QueryHistoryRow,
  queryHistoryTableName,
} from "../tables/query_history.table";

export class QueryHistoryModel extends BasicDataModel(
  QueryHistoryRow,
  queryHistoryTableName,
) {
  async addAndPrune(entry: Omit<QueryHistoryRow, "_id">): Promise<void> {
    await this.insert(entry);

    const all = await this.table
      .filter((d) => d.key("userId").eq(entry.userId))
      .orderBy("executedAt", "desc")
      .run();

    if (all.length > MAX_HISTORY_PER_USER) {
      for (const row of all.slice(MAX_HISTORY_PER_USER)) {
        await this.delete(row._id);
      }
    }
  }

  async listForUser(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<PaginatedResult<QueryHistoryRow>> {
    const baseFilter = this.table.filter((d) => d.key("userId").eq(userId));

    const [total, items] = await Promise.all([
      baseFilter.count().run(),
      baseFilter
        .orderBy("executedAt", "desc")
        .slice(offset, offset + limit)
        .run(),
    ]);

    return { items, total };
  }
}
