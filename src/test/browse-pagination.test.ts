import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import { User } from "@antelopejs/interface-dms/auth/db";
import { DatabaseBrowseController } from "../routes/data";
import { queryContext } from "./requestContext";

const SCHEMA = "browse-pagination-regression";
const INSTANCE = "tenant-a";
const ROWS = 1007;
const MATCH_START = 1000;
interface BrowseRow {
  _id: string;
  rank: number;
  name: string;
}
interface BrowseTables {
  items: BrowseRow;
}
const schema = new Schema<BrowseTables>(SCHEMA, {
  items: {
    fields: { _id: "string", name: "string", rank: "number" },
    indexes: { rank: {} },
  },
});

describe("[integration] refined browse pagination", () => {
  before(async () => {
    await schema
      .instance(INSTANCE)
      .table("items")
      .insert(
        Array.from({ length: ROWS }, (_, rank) => ({
          _id: String(rank),
          rank,
          name: rank >= MATCH_START ? "Évidence" : "other",
        })),
      )
      .run();
    await schema
      .instance("tenant-b")
      .table("items")
      .insert([{ _id: "secret", rank: 2000, name: "Évidence" }])
      .run();
  });

  after(async () => {
    await schema.destroyInstance(INSTANCE).run();
    await schema.destroyInstance("tenant-b").run();
  });

  it("returns exact filtered totals and sorted page results from one tenant", async () => {
    const controller = new DatabaseBrowseController();
    const result = await controller.list(
      new User(),
      queryContext({
        filter_name: "contains:vidence",
        filter_schema: `is:${SCHEMA}`,
        filter_instance: `is:${INSTANCE}`,
        filter_table: "is:items",
        offset: "1",
        limit: "2",
        sortKey: "rank",
        sortDirection: "asc",
        search: "évidence",
      }),
    );
    assert.equal(result.total, ROWS - MATCH_START);
    assert.deepEqual(
      result.results.map<unknown>((row) => row._id),
      ["1001", "1002"],
    );
  });
});
