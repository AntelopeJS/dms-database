import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { ConnectionSelectionModel } from "../db/models/connection_selections.model";
import { QueryHistoryModel } from "../db/models/query_history.model";
import { DatabaseBrowseController } from "../routes/data";
import { DatabaseDiagramController } from "../routes/diagram";
import { DatabaseHealthController } from "../routes/health";
import { DatabaseOverviewController } from "../routes/overview";
import { DatabaseQueryController } from "../routes/query";
import { DatabaseSchemasController } from "../routes/schemas";
import { DatabaseTablesController } from "../routes/tables";
import { refusal } from "./refusal";
import { queryContext } from "./requestContext";
import { encode } from "./stagedWire";

const EXTERNAL = "erp";
const IS_ERP = "is:erp";
const IS_CUSTOMERS = "is:customers";
const EXTERNAL_USER = Object.assign(new User(), {
  _id: "selected-database-external-user",
});
const OWN_USER = Object.assign(new User(), {
  _id: "selected-database-own-user",
});

interface OwnCustomer {
  _id: string;
  name: string;
  city: string;
  vip: boolean;
}

/**
 * The own database's schema of the external one's id and table: what a cache
 * keyed by schema id alone would mix.
 */
const ownErp = new Schema<{ customers: OwnCustomer }>(EXTERNAL, {
  customers: {
    fields: { _id: "string", name: "string", city: "string" },
    indexes: {},
  },
});

const OWN_ROWS: OwnCustomer[] = [
  { _id: "o1", name: "Linus", city: "Helsinki", vip: true },
  { _id: "o2", name: "Margaret", city: "Boston", vip: false },
  { _id: "o3", name: "Barbara", city: "Boston", vip: false },
];

const EXTERNAL_ROWS = [
  { _id: "c1", name: "Ada", segment: "retail" },
  { _id: "c2", name: "Grace", segment: "wholesale" },
];

function browseList(user: User, instance?: string) {
  const sorted = {
    filter_schema: IS_ERP,
    filter_table: IS_CUSTOMERS,
    sortKey: "_id",
    sortDirection: "asc",
  };
  const query =
    instance === undefined ? sorted : { ...sorted, filter_instance: instance };
  return new DatabaseBrowseController().list(user, queryContext(query));
}

async function erpSummary(user: User) {
  const { schemas } = await new DatabaseSchemasController().list(user);
  const summary = schemas.find((candidate) => candidate.id === EXTERNAL);
  assert.ok(summary, "the erp schema is listed");
  return summary;
}

async function customerColumns(user: User): Promise<string[]> {
  const customers = (await erpSummary(user)).tables.find(
    (table) => table.name === "customers",
  );
  assert.ok(customers, "the customers table is listed");
  return Object.keys(customers.fields).sort();
}

function withSelection(): void {
  before(async () => {
    const customers = ownErp.instance().table("customers");
    await customers.delete().run();
    await customers.insert(OWN_ROWS).run();
    await GetModel(ConnectionSelectionModel).select(
      EXTERNAL_USER._id,
      EXTERNAL,
    );
  });

  after(async () => {
    await ownErp.instance().table("customers").delete().run();
  });
}

describe("[integration] every page reads the user's selected database", () => {
  withSelection();

  it("reads an external schema's own cache entries after the own schema of its id filled them", async () => {
    const tables = new DatabaseTablesController();
    await erpSummary(OWN_USER);
    await tables.sourceRow(OWN_USER, "erp::customers");
    assert.equal((await erpSummary(EXTERNAL_USER)).stats.elementCount, 2);
    assert.deepEqual(await customerColumns(EXTERNAL_USER), [
      "_id",
      "name",
      "segment",
    ]);
    const row = await tables.sourceRow(EXTERNAL_USER, "erp::customers");
    assert.equal(row.elementCount, 2);
  });

  it("lists the external database's schemas, tables and rows once the user selects it", async () => {
    const { schemas } = await new DatabaseSchemasController().list(
      EXTERNAL_USER,
    );
    assert.deepEqual(
      schemas.map(({ id, stats, instances }) => ({ id, stats, instances })),
      [
        {
          id: EXTERNAL,
          stats: { tableCount: 1, elementCount: 2, instanceCount: 1 },
          instances: [],
        },
      ],
    );
    const { items } = await new DatabaseOverviewController().schemas(
      EXTERNAL_USER,
    );
    assert.deepEqual(
      items.map((item) => item.id),
      [EXTERNAL],
    );
    const page = await browseList(EXTERNAL_USER);
    assert.deepEqual(page.results, EXTERNAL_ROWS);
    assert.equal(page.primaryKey, "_id");
    assert.deepEqual(
      await new DatabaseBrowseController().count(
        EXTERNAL_USER,
        IS_ERP,
        undefined,
        IS_CUSTOMERS,
      ),
      { total: 2 },
    );
  });

  it("still answers the own database for a user who selected none", async () => {
    const { schemas } = await new DatabaseSchemasController().list(OWN_USER);
    assert.ok(
      schemas.length > 1,
      "the own database lists every schema of the project",
    );
    assert.deepEqual((await browseList(OWN_USER)).results, OWN_ROWS);
    assert.deepEqual(
      await new DatabaseBrowseController().count(
        OWN_USER,
        IS_ERP,
        undefined,
        IS_CUSTOMERS,
      ),
      { total: 3 },
    );
    const { items } = await new DatabaseOverviewController().schemas(OWN_USER);
    assert.ok(items.some((item) => item.id === EXTERNAL));
    assert.ok(items.length > 1);
  });

  it("probes, names and totals the external database, not the own one", async () => {
    const health = await new DatabaseHealthController().health(EXTERNAL_USER);
    assert.equal(health.status, "ok", health.error ?? "");
    assert.deepEqual(
      {
        driver: health.driver,
        schemaCount: health.schemaCount,
        totalRows: health.totalRows,
        storage: health.storage,
      },
      {
        driver: "mongodb 8.0.8",
        schemaCount: 1,
        totalRows: 2,
        storage: [{ schema: EXTERNAL, table: "customers", rows: 2 }],
      },
    );
  });
});

describe("[integration] what the selected external database refuses", () => {
  withSelection();

  it("lists no instance of an external schema and refuses one in a browse", async () => {
    await ownErp.createInstance("eu").run();
    const tables = new DatabaseTablesController();
    try {
      assert.deepEqual(
        await tables.instances(EXTERNAL_USER, EXTERNAL, undefined, undefined),
        { instances: [], total: 0 },
      );
      assert.deepEqual(
        await tables.instances(OWN_USER, EXTERNAL, undefined, undefined),
        { instances: ["eu"], total: 1 },
      );
    } finally {
      await ownErp.destroyInstance("eu").run();
    }
    for (const instance of ["is:eu", "is:__CROSS_INSTANCE__"]) {
      assert.deepEqual(await refusal(browseList(EXTERNAL_USER, instance)), {
        status: 400,
        message: "erp has no instances: read its tables without one",
      });
    }
  });

  it("refuses an edit while the external database's access is read", async () => {
    assert.deepEqual(
      await refusal(
        new DatabaseBrowseController().edit(
          EXTERNAL_USER,
          queryContext({
            filter_schema: IS_ERP,
            filter_table: IS_CUSTOMERS,
            id: "c1",
            connection: EXTERNAL,
          }),
          { name: "Ada Lovelace" },
        ),
      ),
      { status: 403, message: "Access to erp is read only" },
    );
    assert.deepEqual((await browseList(EXTERNAL_USER)).results, EXTERNAL_ROWS);
  });

  it("refuses the query console, the diagram and a row's references on the external database", async () => {
    const query = encode(ownErp.instance().table("customers"));
    const queries = new DatabaseQueryController();
    const consoleRefusal = {
      status: 409,
      message: "The query console is not available on an external database",
    };
    assert.deepEqual(
      await refusal(
        queries.execute(EXTERNAL_USER, {
          query,
          source: "customers",
          language: "aql",
        }),
      ),
      consoleRefusal,
    );
    assert.deepEqual(
      await refusal(queries.dryRun(EXTERNAL_USER, { query })),
      consoleRefusal,
    );
    const diagram = new DatabaseDiagramController();
    const diagramRefusal = {
      status: 409,
      message: "The diagram is not available on an external database",
    };
    assert.deepEqual(
      await refusal(diagram.getLayout(EXTERNAL_USER, EXTERNAL)),
      diagramRefusal,
    );
    assert.deepEqual(
      await refusal(diagram.listNotes(EXTERNAL_USER, EXTERNAL)),
      diagramRefusal,
    );
    assert.deepEqual(
      await refusal(
        new DatabaseBrowseController().references(
          EXTERNAL_USER,
          IS_ERP,
          undefined,
          IS_CUSTOMERS,
          "c1",
        ),
      ),
      {
        status: 409,
        message: "A row's references is not available on an external database",
      },
    );
  });
});

describe("[integration] the overview of the selected external database", () => {
  it("lists none of the console's query runs, which ran on the own database, once an external one is selected", async () => {
    const runner = Object.assign(new User(), { _id: "recent-queries-user" });
    await GetModel(QueryHistoryModel).addAndPrune({
      userId: runner._id,
      executedAt: new Date(),
      query: {},
      source: "OWN-DB customers query",
      language: "aql",
      durationMs: 1,
      rowCount: 1,
      status: "ok",
    });
    const overview = new DatabaseOverviewController();
    assert.equal((await overview.recentQueries(runner)).items.length, 1);
    await GetModel(ConnectionSelectionModel).select(runner._id, EXTERNAL);
    assert.deepEqual(await overview.recentQueries(runner), { items: [] });
  });
});
