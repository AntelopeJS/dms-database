import { strict as assert } from "node:assert";
import { Query, Schema, type Stream } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { QueryHistoryModel } from "../db";
import { DatabaseQueryController } from "../routes/query";
import { encode } from "./stagedWire";

const SCHEMA = "query-row-limit-qa";
const USER = Object.assign(new User(), { _id: "query-row-limit-user" });
const MAX_RESULT_ROWS = 1000;
const ROWS = 1500;
const RANKS = 7;

interface Item {
  _id: string;
  rank: number;
  label: string;
}

const schema = new Schema<{ items: Item }>(SCHEMA, {
  items: {
    fields: { _id: "string", rank: "number", label: "string" },
    indexes: { rank: {} },
  },
});

/** A read the console runs: the rows of the table, or a projection of them. */
type ConsoleQuery = Stream<Item> | Stream<Pick<Item, "_id" | "label">>;

function items() {
  return schema.instance().table("items");
}

/** Rows inserted out of key order, seven ranks shared by about 200 rows each. */
function fixture(): Item[] {
  return Array.from({ length: ROWS }, (_, n) => {
    const key = (n * 7919) % ROWS;
    return {
      _id: `item-${String(key).padStart(4, "0")}`,
      rank: key % RANKS,
      label: key % 2 === 0 ? "even" : "odd",
    };
  });
}

/** What the console answered before it cut in the database: the whole run, cut in Node. */
async function answerBefore(query: ConsoleQuery) {
  const rows = await query.run();
  return {
    rows: rows.slice(0, MAX_RESULT_ROWS),
    rowCount: rows.length,
    truncated: rows.length > MAX_RESULT_ROWS,
  };
}

/** The console's answer, and the most rows one database run handed back while it answered. */
async function answerNow(query: ConsoleQuery) {
  const originalRun = Object.getOwnPropertyDescriptor(Query.prototype, "run");
  assert.ok(originalRun);
  let mostRowsRead = 0;
  Query.prototype.run = async function () {
    Object.defineProperty(this, "run", originalRun);
    const answer: unknown = await this.run();
    if (Array.isArray(answer))
      mostRowsRead = Math.max(mostRowsRead, answer.length);
    return answer;
  };
  try {
    const { rows, rowCount, truncated } =
      await new DatabaseQueryController().execute(USER, {
        query: encode(query),
        source: "items",
        language: "aql",
      });
    return { answer: { rows, rowCount, truncated }, mostRowsRead };
  } finally {
    Object.defineProperty(Query.prototype, "run", originalRun);
  }
}

const QUERIES: [string, () => ConsoleQuery][] = [
  ["a whole table", () => items()],
  ["a sort with ties", () => items().orderBy("rank")],
  ["a descending sort with ties", () => items().orderBy("rank", "desc")],
  ["a sort on a unique key", () => items().orderBy("_id", "desc")],
  [
    "a filter over the cap",
    () => items().filter((row) => row.key("rank").ne(0)),
  ],
  [
    "a filter under the cap",
    () => items().filter((row) => row.key("rank").eq(3)),
  ],
  ["the query's own slice", () => items().orderBy("rank").slice(100, 1200)],
  ["a projection", () => items().orderBy("rank").pluck("_id", "label")],
];

describe("[integration] query console row limit", () => {
  before(async () => {
    await items().insert(fixture()).run();
  });

  after(async () => {
    await items().delete().run();
    await GetModel(QueryHistoryModel).clearForUser(USER._id);
  });

  for (const [name, query] of QUERIES) {
    it(`answers ${name} as it did, reading at most one row past the cap`, async () => {
      const before = await answerBefore(query());
      const { answer, mostRowsRead } = await answerNow(query());
      assert.deepEqual(answer, before);
      assert.ok(
        mostRowsRead <= MAX_RESULT_ROWS + 1,
        `one run read ${mostRowsRead} rows`,
      );
    });
  }

  it("keeps the total of a cut result in the run's history", async () => {
    await answerNow(items());
    const { items: runs } = await GetModel(QueryHistoryModel).listForUser(
      USER._id,
      1,
      0,
    );
    assert.equal(runs[0]?.rowCount, ROWS);
  });
});
