import { strict as assert } from "node:assert";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { getModuleConfig, setModuleConfig } from "../config";
import { ConnectionSelectionModel } from "../db/models/connection_selections.model";
import { DatabaseBrowseController } from "../routes/data";
import { resolveDatabase } from "../service/connections";
import type { Database } from "../service/database";
import { TIMED_OUT, withDeadline } from "../utils/deadline";
import { refusal } from "./refusal";
import { queryContext } from "./requestContext";

const USER = Object.assign(new User(), { _id: "external-bounds-user" });
const CUSTOMERS = { filter_schema: "is:erp", filter_table: "is:customers" };
const FILLER_ROWS = 10_001;
const FILLER = Array.from({ length: FILLER_ROWS }, (_, index) => ({
  _id: `filler-${String(index).padStart(6, "0")}`,
  name: "Filler",
  segment: "filler",
}));
const NEEDLE = { _id: "zz-needle", name: "Needle", segment: "needle" };
const SEEDED_ROWS = 2;

function customers(erp: Database) {
  const table = erp.schemas().get("erp")?.instance().table("customers");
  assert.ok(table, "the erp binding declares customers");
  return table;
}

const browse = new DatabaseBrowseController();
const original = getModuleConfig();

describe("[integration] an external database's filters run in its query", () => {
  before(async () => {
    await GetModel(ConnectionSelectionModel).select(USER._id, "erp");
    await customers(await resolveDatabase("erp"))
      .insert([...FILLER, NEEDLE])
      .run();
  });

  after(async () => {
    await customers(await resolveDatabase("erp"))
      .filter((row) => row.key("segment").eq("filler"))
      .delete()
      .run();
    await customers(await resolveDatabase("erp"))
      .filter((row) => row.key("_id").eq(NEEDLE._id))
      .delete()
      .run();
    setModuleConfig(original);
  });

  it("finds a match past the first 10,000 rows, which a scan that stops at 10,000 rows would not", async () => {
    const page = await browse.list(
      USER,
      queryContext({ ...CUSTOMERS, search: "needle" }),
    );
    assert.deepEqual(
      page.results.map<unknown>((row) => row._id),
      [NEEDLE._id],
    );
    assert.equal(page.total, 1);
  });

  it("counts every match of a column filter, which a count that stops at 10,000 rows would not", async () => {
    const page = await browse.list(
      USER,
      queryContext({ ...CUSTOMERS, filter_segment: "contains:filler" }),
    );
    assert.equal(page.total, FILLER_ROWS);
  });

  it("reads a page past the first 10,000 matches", async () => {
    const page = await browse.list(
      USER,
      queryContext({
        ...CUSTOMERS,
        filter_segment: "contains:filler",
        offset: "10000",
        limit: "5",
      }),
    );
    assert.deepEqual(
      page.results.map<unknown>((row) => row._id),
      [FILLER[FILLER_ROWS - 1]?._id],
    );
  });

  it("counts every row of the table, which a count that stops at 10,000 rows would not", async () => {
    const exact = FILLER_ROWS + SEEDED_ROWS + 1;
    const page = await browse.list(USER, queryContext(CUSTOMERS));
    assert.equal(page.total, exact);
    assert.deepEqual(
      await browse.count(USER, "is:erp", undefined, "is:customers"),
      { total: exact },
    );
  });
});

describe("[integration] browse inputs name the table's own columns", () => {
  before(async () => {
    await GetModel(ConnectionSelectionModel).select(USER._id, "erp");
  });

  afterEach(() => setModuleConfig(original));

  it("refuses a sort on a column the table does not have, which a sort key passed to the database as it is would run", async () => {
    assert.deepEqual(
      await refusal(
        browse.list(USER, queryContext({ ...CUSTOMERS, sortKey: "$where" })),
      ),
      { status: 400, message: "Unknown column: $where" },
    );
  });

  it("refuses an edit naming a field the table does not have, which an edit body passed to the database as it is would write", async () => {
    setModuleConfig({
      ...original,
      externalConnections: { erp: { access: "read-write" } },
    });
    assert.deepEqual(
      await refusal(
        browse.edit(
          USER,
          queryContext({ ...CUSTOMERS, id: "c1", connection: "erp" }),
          { "segment.$": "x" },
        ),
      ),
      { status: 400, message: "Unknown column: segment.$" },
    );
  });
});

describe("a deadline", () => {
  it("answers TIMED_OUT for work that never settles, which waiting on it would never answer", async () => {
    assert.equal(await withDeadline(new Promise(() => {}), 10), TIMED_OUT);
    assert.equal(await withDeadline(Promise.resolve("done"), 10), "done");
  });
});
