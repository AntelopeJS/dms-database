import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { ConnectionSelectionModel } from "../db/models/connection_selections.model";
import { DatabaseBrowseController } from "../routes/data";
import { resolveDatabase } from "../service/connections";
import { refusal } from "./refusal";
import { queryContext } from "./requestContext";

interface Customer {
  _id: string;
  name: string;
  segment: string;
}

/** The rows both databases hold: the first two are the ones the harness seeds in `erp.customers`. */
const ROWS: Customer[] = [
  { _id: "c1", name: "Ada", segment: "retail" },
  { _id: "c2", name: "Grace", segment: "wholesale" },
  { _id: "r1", name: "Évidence", segment: "a.b" },
  { _id: "r2", name: "évidence", segment: "axb" },
  { _id: "r3", name: "Plain", segment: "A.B" },
  { _id: "r4", name: "price (x)", segment: "literal" },
  { _id: "r5", name: "Plain Text", segment: "plain" },
  { _id: "r6", name: "100% pure", segment: "back\\slash" },
];
const HARNESS_SEEDED = 2;

const OWN_SCHEMA = "browse-filters-own";
const own = new Schema<{ customers: Customer }>(OWN_SCHEMA, {
  customers: {
    fields: { _id: "string", name: "string", segment: "string" },
    indexes: {},
  },
});

function erpCustomers() {
  const table = resolveDatabase("erp")
    .schemas()
    .get("erp")
    ?.instance()
    .table("customers");
  assert.ok(table, "the erp binding declares customers");
  return table;
}

const OWN_USER = Object.assign(new User(), { _id: "browse-filters-own-user" });
const ERP_USER = Object.assign(new User(), { _id: "browse-filters-erp-user" });

const DATABASES = [
  {
    name: "the own database",
    user: OWN_USER,
    table: { filter_schema: `is:${OWN_SCHEMA}`, filter_table: "is:customers" },
  },
  {
    name: "an external database",
    user: ERP_USER,
    table: { filter_schema: "is:erp", filter_table: "is:customers" },
  },
];

const browse = new DatabaseBrowseController();

async function read(
  database: (typeof DATABASES)[number],
  query: Record<string, string>,
) {
  const answer = await browse.list(
    database.user,
    queryContext({ ...database.table, sortKey: "_id", ...query }),
  );
  return {
    ids: answer.results.map<unknown>((row) => row._id),
    total: answer.total,
  };
}

interface FilterCase {
  name: string;
  query: Record<string, string>;
  ids: string[];
  total?: number;
}

const CASES: FilterCase[] = [
  {
    name: "folds the case of a non-ASCII capital in a search, which a lowercasing that leaves É alone would not",
    query: { search: "ÉVIDENCE" },
    ids: ["r1", "r2"],
  },
  {
    name: "folds the case of a non-ASCII capital the cell holds in a search",
    query: { search: "évidence" },
    ids: ["r1", "r2"],
  },
  {
    name: "searches the columns that are not the first one",
    query: { search: "wholesale" },
    ids: ["c2"],
  },
  {
    name: "reads the dot of a contains filter as a dot, which an unescaped pattern would read as any character",
    query: { filter_segment: "contains:a.b" },
    ids: ["r1", "r3"],
  },
  {
    name: "reads parentheses of a contains filter as text, which an unescaped pattern would read as a group",
    query: { filter_name: "contains:(x)" },
    ids: ["r4"],
  },
  {
    name: "reads a backslash of a contains filter as text",
    query: { filter_segment: "contains:\\" },
    ids: ["r6"],
  },
  {
    name: "reads a null character of a search as text, which a pattern holding it would make the database refuse",
    query: { search: "a\u0000b" },
    ids: [],
  },
  {
    name: "matches the exact text with is, which a substring would not",
    query: { filter_segment: "is:a.b" },
    ids: ["r1"],
  },
  {
    name: "matches is with the case of the text, which a folded comparison would not",
    query: { filter_name: "is:plain" },
    ids: [],
  },
  {
    name: "matches is on the cell's own case",
    query: { filter_name: "is:Plain" },
    ids: ["r3"],
  },
  {
    name: "reads a token with no mode as is",
    query: { filter_name: "Plain" },
    ids: ["r3"],
  },
  {
    name: "holds a filter and a search together, which either alone would not",
    query: { filter_name: "contains:plain", search: "text" },
    ids: ["r5"],
  },
  {
    name: "holds two filters together",
    query: { filter_name: "contains:plain", filter_segment: "is:plain" },
    ids: ["r5"],
  },
  {
    name: "totals the matches, not the page",
    query: {
      filter_name: "contains:vidence",
      offset: "1",
      limit: "1",
    },
    ids: ["r2"],
    total: 2,
  },
];

describe("[integration] a filter gives the same rows on the own database and an external one", () => {
  before(async () => {
    await GetModel(ConnectionSelectionModel).select(ERP_USER._id, "erp");
    await own.instance().table("customers").insert(ROWS).run();
    await erpCustomers().insert(ROWS.slice(HARNESS_SEEDED)).run();
  });

  after(async () => {
    await own.instance().table("customers").delete().run();
    for (const { _id } of ROWS.slice(HARNESS_SEEDED)) {
      await erpCustomers()
        .filter((row) => row.key("_id").eq(_id))
        .delete()
        .run();
    }
  });

  for (const { name, query, ids, total } of CASES) {
    it(`${name}`, async () => {
      const expected = { ids, total: total ?? ids.length };
      for (const database of DATABASES) {
        assert.deepEqual(
          await read(database, query),
          expected,
          `${database.name} answers the expected rows and total`,
        );
      }
    });
  }

  for (const database of DATABASES) {
    it(`refuses a filter on a column the table does not have on ${database.name}, which a column name passed to the database as it is would run`, async () => {
      assert.deepEqual(
        await refusal(read(database, { filter_$where: "is:x" })),
        { status: 400, message: "Unknown column: $where" },
      );
    });
  }
});

const METRICS_SCHEMA = "browse-filters-metrics";
interface Metric {
  _id: string;
  label: string;
  stock: number;
  active: boolean;
  meta: { tag: string };
  "unit.price": string;
}
const metrics = new Schema<{ metrics: Metric }>(METRICS_SCHEMA, {
  metrics: {
    fields: {
      _id: "string",
      label: "string",
      stock: "number",
      active: "boolean",
    },
    indexes: {},
  },
});
const METRICS: Metric[] = [
  {
    _id: "m1",
    label: "forty-two",
    stock: 42,
    active: true,
    meta: { tag: "needle" },
    "unit.price": "cheap",
  },
  {
    _id: "m2",
    label: "four",
    stock: 4,
    active: false,
    meta: { tag: "y" },
    "unit.price": "dear",
  },
  {
    _id: "m3",
    label: "many",
    stock: 420,
    active: true,
    meta: { tag: "y" },
    "unit.price": "dear",
  },
  {
    _id: "m4",
    label: "none",
    stock: 0,
    active: false,
    meta: { tag: "y" },
    "unit.price": "dear",
  },
  {
    _id: "m5",
    label: "owed",
    stock: -1.5,
    active: false,
    meta: { tag: "y" },
    "unit.price": "dear",
  },
];

async function readMetrics(query: Record<string, string>) {
  const answer = await browse.list(
    OWN_USER,
    queryContext({
      filter_schema: `is:${METRICS_SCHEMA}`,
      filter_table: "is:metrics",
      sortKey: "_id",
      ...query,
    }),
  );
  return {
    ids: answer.results.map<unknown>((row) => row._id),
    total: answer.total,
  };
}

interface MetricCase {
  name: string;
  query: Record<string, string>;
  ids: string[];
}

const METRIC_CASES: MetricCase[] = [
  {
    name: "compares a number column's whole value with is, which a substring of its text would not",
    query: { filter_stock: "is:4" },
    ids: ["m2"],
  },
  {
    name: "compares a number column's whole value with contains too",
    query: { filter_stock: "contains:42" },
    ids: ["m1"],
  },
  {
    name: "reads a decimal and a negative number",
    query: { filter_stock: "is:-1.5" },
    ids: ["m5"],
  },
  {
    name: "keeps a filter on the number zero, which a falsy check would drop",
    query: { filter_stock: "is:0" },
    ids: ["m4"],
  },
  {
    name: "ignores the blanks around a number",
    query: { filter_stock: "is: 42 " },
    ids: ["m1"],
  },
  {
    name: "matches no row for a number filter that is not a number",
    query: { filter_stock: "contains:4x" },
    ids: [],
  },
  {
    name: "reads is true and is false of a boolean column",
    query: { filter_active: "is:true" },
    ids: ["m1", "m3"],
  },
  {
    name: "matches no row for an is filter of a boolean column that is neither true nor false",
    query: { filter_active: "is:yes" },
    ids: [],
  },
  {
    name: "reads contains of a boolean column as part of true or false, in any case",
    query: { filter_active: "contains:ALS" },
    ids: ["m2", "m4", "m5"],
  },
  {
    name: "matches both booleans for a part of both words",
    query: { filter_active: "contains:e" },
    ids: ["m1", "m2", "m3", "m4", "m5"],
  },
  {
    name: "matches no row for a part that is in neither boolean word",
    query: { filter_active: "contains:x" },
    ids: [],
  },
  {
    name: "searches a number column by its whole value and a text column by a part",
    query: { search: "4" },
    ids: ["m2", "m4"],
  },
  {
    name: "searches a true or false column",
    query: { search: "true" },
    ids: ["m1", "m3"],
  },
  {
    name: "skips an object column in a search, which a search of its JSON text would find",
    query: { search: "needle" },
    ids: [],
  },
  {
    name: "searches the other columns of a table that has an object column",
    query: { search: "forty" },
    ids: ["m1"],
  },
];

describe("[integration] a filter on number, true or false and object columns", () => {
  before(async () => {
    await metrics.instance().table("metrics").insert(METRICS).run();
  });

  after(async () => {
    await metrics.instance().table("metrics").delete().run();
  });

  for (const { name, query, ids } of METRIC_CASES) {
    it(`${name}`, async () => {
      assert.deepEqual(await readMetrics(query), {
        ids,
        total: ids.length,
      });
    });
  }

  it("refuses a filter on an object column, which a comparison of its text would not", async () => {
    const { status, message } = await refusal(
      readMetrics({ filter_meta: "contains:needle" }),
    );
    assert.equal(status, 400);
    assert.match(message, /\bmeta\b/);
  });

  it("refuses a filter on a column whose name holds a dot, which a query reading it as a nested field would answer with no row", async () => {
    const { status, message } = await refusal(
      readMetrics({ "filter_unit.price": "is:cheap" }),
    );
    assert.equal(status, 400);
    assert.match(message, /unit\.price/);
    assert.match(message, /nested field/);
  });
});
