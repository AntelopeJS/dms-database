import { strict as assert } from "node:assert";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { QueryHistoryModel, type QueryHistoryRow } from "../db";
import { MAX_HISTORY_PER_USER } from "../types/constants";

const BASE_TIME = Date.UTC(2026, 0, 1);

function historyRow(
  userId: string,
  minute: number,
): Omit<QueryHistoryRow, "_id"> {
  return {
    userId,
    executedAt: new Date(BASE_TIME + minute * 60_000),
    query: {},
    source: `query ${minute}`,
    language: "aql",
    durationMs: 1,
    rowCount: 0,
  };
}

function minutesOf(rows: QueryHistoryRow[]): number[] {
  return rows.map(
    (row) => (new Date(row.executedAt).getTime() - BASE_TIME) / 60_000,
  );
}

async function clearUser(userId: string): Promise<void> {
  await GetModel(QueryHistoryModel)
    .table.filter((d) => d.key("userId").eq(userId))
    .delete()
    .run();
}

describe("[integration] query history", () => {
  const PAGED_USER = "history-pagination-user";
  const PRUNED_USER = "history-prune-user";

  after(async () => {
    await clearUser(PAGED_USER);
    await clearUser(PRUNED_USER);
  });

  it("returns exactly one page of rows for a non-zero offset", async () => {
    const model = GetModel(QueryHistoryModel);
    await model.insert(
      Array.from({ length: 10 }, (_, minute) => historyRow(PAGED_USER, minute)),
    );

    const { items, total } = await model.listForUser(PAGED_USER, 3, 3);

    assert.equal(total, 10);
    assert.deepEqual(minutesOf(items), [6, 5, 4]);
  });

  it("keeps only the most recent entries per user when pruning", async () => {
    const model = GetModel(QueryHistoryModel);
    await model.insert(
      Array.from({ length: MAX_HISTORY_PER_USER + 1 }, (_, minute) =>
        historyRow(PRUNED_USER, minute),
      ),
    );

    await model.addAndPrune(historyRow(PRUNED_USER, MAX_HISTORY_PER_USER + 1));

    const { items, total } = await model.listForUser(PRUNED_USER, 1, 0);
    assert.equal(total, MAX_HISTORY_PER_USER);
    assert.deepEqual(minutesOf(items), [MAX_HISTORY_PER_USER + 1]);
    const oldest = await model.listForUser(
      PRUNED_USER,
      1,
      MAX_HISTORY_PER_USER - 1,
    );
    assert.deepEqual(minutesOf(oldest.items), [2]);
  });
});
