import { strict as assert } from "node:assert";
import type { RequestContext } from "@antelopejs/interface-api";
import { Schema } from "@antelopejs/interface-database";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { DatabaseBrowseController } from "../routes/data";

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
    const context = {
      url: new URL("https://example.test/?filter_name=contains:vidence"),
    } as RequestContext;
    const result = await controller.list(
      {} as User,
      context,
      `is:${SCHEMA}`,
      `is:${INSTANCE}`,
      "is:items",
      "1",
      "2",
      "rank",
      "asc",
      "évidence",
    );
    assert.equal(result.total, ROWS - MATCH_START);
    assert.deepEqual(
      result.results.map((row) => row._id),
      ["1001", "1002"],
    );
  });
});
