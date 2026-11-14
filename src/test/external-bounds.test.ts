import { strict as assert } from "node:assert";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { getModuleConfig, setModuleConfig } from "../config";
import { ConnectionSelectionModel } from "../db/models/connection_selections.model";
import { DatabaseBrowseController } from "../routes/data";
import { EXTERNAL_SCAN_CAP } from "../service/browse";
import { resolveDatabase } from "../service/connections";
import { TIMED_OUT, withDeadline } from "../utils/deadline";
import { isRecord } from "../utils/guards";
import { refusal } from "./refusal";
import { queryContext } from "./requestContext";

const USER = Object.assign(new User(), { _id: "external-bounds-user" });
const CUSTOMERS = { filter_schema: "is:erp", filter_table: "is:customers" };
const FILLER = Array.from({ length: EXTERNAL_SCAN_CAP + 1 }, (_, index) => ({
  _id: `filler-${String(index).padStart(6, "0")}`,
  name: "Filler",
  segment: "filler",
}));

function customers() {
  const table = resolveDatabase("erp")
    .schemas()
    .get("erp")
    ?.instance()
    .table("customers");
  assert.ok(table, "the erp binding declares customers");
  return table;
}

const browse = new DatabaseBrowseController();
const original = getModuleConfig();

describe("[integration] an external database's pages are bounded", () => {
  before(async () => {
    await GetModel(ConnectionSelectionModel).select(USER._id, "erp");
    await customers().insert(FILLER).run();
  });

  after(async () => {
    await customers()
      .filter((row) => row.key("segment").eq("filler"))
      .delete()
      .run();
    setModuleConfig(original);
  });

  it("reads at most the scan cap for a search, and says the page is capped, which a scan of the whole table would not", async () => {
    const page = await browse.list(
      USER,
      queryContext({ ...CUSTOMERS, search: "Grace" }),
    );
    assert.ok(isRecord(page));
    assert.equal(page.capped, true);
    assert.ok(Array.isArray(page.results));
    assert.ok(page.total !== undefined);
  });

  it("stops the count at the scan cap, which an exact count of a large table would not", async () => {
    const page = await browse.list(USER, queryContext(CUSTOMERS));
    assert.ok(isRecord(page));
    assert.equal(page.total, EXTERNAL_SCAN_CAP);
    assert.equal(page.capped, true);
    assert.deepEqual(
      await browse.count(USER, "is:erp", undefined, "is:customers"),
      { total: EXTERNAL_SCAN_CAP },
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
