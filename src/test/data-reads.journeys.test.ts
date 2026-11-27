import { strict as assert } from "node:assert";
import {
  ALL,
  column,
  CUSTOMERS,
  type DataApi,
  DEMO,
  message,
  METRICS,
  rowsOf,
  SHOP,
  withDataFixture,
} from "./dataJourneys";
import { REFUSALS } from "../service/refusals";
import { objectsAt, pick, text } from "./helpers/pick";
import type { HttpAnswer } from "./helpers/http";
import { LOADED_HOST_TIMEOUT_MS } from "./helpers/timeouts";

async function assertSelectionDecoding(api: DataApi): Promise<void> {
  const count = async (params: Record<string, string>) =>
    pick((await api.browse("count", CUSTOMERS, params)).body, "total");
  assert.deepEqual(
    {
      default: await count({}),
      eu: await count({ filter_instance: "is:eu" }),
      us: await count({ filter_instance: "is:us" }),
      all: await count({ filter_instance: `is:${ALL}` }),
      empty: await count({ filter_instance: "is:" }),
      contains: await count({ filter_instance: "contains:eu" }),
      bare: await count({ filter_instance: "eu" }),
    },
    {
      default: 0,
      eu: 24,
      us: 24,
      all: 48,
      empty: 0,
      contains: 0,
      bare: 24,
    },
    "the instance is the default one when absent, empty or not is:, a named one, or every one for the cross-instance token",
  );
  const unknownInstance = await api.browse("count", CUSTOMERS, {
    filter_instance: "is:nowhere",
  });
  assert.ok(
    unknownInstance.status !== 200 || pick(unknownInstance.body, "total") === 0,
    `an unknown instance is refused or empty, never another instance's rows: ${unknownInstance.text}`,
  );
  const noSchema = await api.get("/browse/count?filter_table=is:customers");
  const noTable = await api.get(`/browse/count?filter_schema=is:${SHOP}`);
  assert.deepEqual(
    [noSchema.status, noTable.status],
    [400, 400],
    "a missing schema or table is 400",
  );
  assert.equal(
    pick(noSchema.body, "params", "name"),
    "filter_schema",
    "the 400 names the schema",
  );
  assert.equal(
    pick(noTable.body, "params", "name"),
    "filter_table",
    "the 400 names the table",
  );
  const containsSchema = await api.get(
    `/browse/count?filter_schema=contains:${SHOP}&filter_table=is:customers`,
  );
  assert.equal(containsSchema.status, 400, "a contains: schema is missing");
  const bare = await api.get(
    `/browse/count?filter_schema=${SHOP}&filter_table=customers&filter_instance=is:eu`,
  );
  assert.deepEqual(
    [bare.status, pick(bare.body, "total")],
    [200, 24],
    "a bare schema and table are accepted",
  );
  const unknownSchema = await api.browse("count", "nowhere.customers");
  const unknownTable = await api.browse("count", `${SHOP}.nowhere`);
  assert.deepEqual(
    [
      [unknownSchema.status, message(unknownSchema)],
      [unknownTable.status, message(unknownTable)],
    ],
    [
      [404, REFUSALS.unknownSchema.key],
      [404, REFUSALS.unknownTable.key],
    ],
    "an unknown schema or table is 404",
  );
  const allRows = await api.browse("list", CUSTOMERS, {
    filter_instance: `is:${ALL}`,
    limit: 200,
    sortKey: "_id",
  });
  assert.deepEqual(
    {
      rows: rowsOf(allRows).length,
      instances: new Set(column(allRows, "_instance")),
    },
    { rows: 48, instances: new Set(["eu", "us"]) },
    "the cross-instance rows are those of eu and us, tagged with _instance",
  );
  const euRows = await api.browse("list", CUSTOMERS, {
    filter_instance: "is:eu",
    limit: 3,
    sortKey: "_id",
  });
  assert.deepEqual(
    {
      ids: column(euRows, "_id"),
      instances: column(euRows, "_instance"),
    },
    {
      ids: ["eu_cus_000", "eu_cus_001", "eu_cus_002"],
      instances: ["eu", "eu", "eu"],
    },
    "a single instance's rows are tagged with that instance",
  );
}

async function assertColumnsAndTypes(api: DataApi): Promise<void> {
  const columns = await api.browse("columns", `${SHOP}.orders`, {
    filter_instance: "is:eu",
  });
  assert.deepEqual(
    pick(columns.body, "columns"),
    [
      "_id",
      "number",
      "customer_id",
      "status",
      "created_at",
      "channel",
      "total",
      "currency",
      "coupon_id",
      "shipping",
      "_instance",
    ],
    "a column list in sample order, or with the instance tag among the declared columns",
  );
  const types = pick(columns.body, "types");
  assert.deepEqual(
    {
      primaryKey: pick(columns.body, "primaryKey"),
      total: pick(types, "total"),
      status: pick(types, "status"),
      shipping: pick(types, "shipping"),
      created_at: pick(types, "created_at"),
      coupon_id: pick(types, "coupon_id"),
    },
    {
      primaryKey: "_id",
      total: "number",
      status: "string",
      shipping: "object",
      created_at: "date",
      coupon_id: "string",
    },
    "the types name each column's runtime type, and a null cell takes the type of a later row",
  );
  const customers = await api.browse("columns", CUSTOMERS, {
    filter_instance: "is:eu",
  });
  assert.deepEqual(
    [
      pick(customers.body, "types", "vip"),
      pick(customers.body, "types", "credit_limit"),
    ],
    ["boolean", "number"],
    "customers: a boolean and a number column",
  );
  const empty = await api.browse("columns", `${METRICS}.empty_log`);
  assert.deepEqual(
    pick(empty.body, "columns"),
    [],
    "an empty table has no sampled column",
  );
}

async function assertRowsAndTables(api: DataApi): Promise<void> {
  const ORDERS = `${SHOP}.orders`;
  const row = await api.browse("get", ORDERS, {
    filter_instance: "is:eu",
    id: "eu_ord_10400",
  });
  assert.deepEqual(
    {
      _id: pick(row.body, "_id"),
      number: pick(row.body, "number"),
      customer_id: pick(row.body, "customer_id"),
      carrier: pick(row.body, "shipping", "carrier"),
    },
    {
      _id: "eu_ord_10400",
      number: "#10400",
      customer_id: "eu_cus_000",
      carrier: "DHL",
    },
    "get answers the stored row",
  );
  const otherInstance = await api.browse("get", ORDERS, {
    filter_instance: "is:us",
    id: "eu_ord_10400",
  });
  assert.deepEqual(
    [otherInstance.status, message(otherInstance)],
    [404, REFUSALS.rowNotFound.key],
    "get reads the instance asked: the id of eu is not in us",
  );
  assert.deepEqual(
    [
      (
        await api.browse("get", ORDERS, {
          filter_instance: "is:eu",
          id: "nope",
        })
      ).status,
      (await api.browse("get", ORDERS, { filter_instance: "is:eu" })).status,
    ],
    [404, 400],
    "get of a missing id is 404, without an id 400",
  );
  const counts = async (query: string) =>
    Object.fromEntries(
      objectsAt((await api.get(`/browse/tables?${query}`)).body, "items").map(
        (item) => [text(item.name), item.elementCount ?? null],
      ),
    );
  assert.deepEqual(
    {
      eu: await counts(`filter_schema=is:${SHOP}&filter_instance=is:eu`),
      default: await counts(`filter_schema=is:${SHOP}`),
      all: await counts(`filter_schema=is:${SHOP}&filter_instance=is:${ALL}`),
      metrics: await counts(`filter_schema=is:${METRICS}`),
    },
    {
      eu: { customers: 24, products: 6, orders: 80, order_items: 160 },
      default: { customers: 0, products: 6, orders: 0, order_items: 0 },
      all: { customers: 48, products: 18, orders: 160, order_items: 320 },
      metrics: { readings: 1250, empty_log: 0 },
    },
    "tables count the rows of the picked instance, or of every instance for the cross-instance token",
  );
  const noSchema = await api.get("/browse/tables");
  const unknown = await api.get("/browse/tables?filter_schema=is:nowhere");
  assert.deepEqual(
    [
      noSchema.status,
      unknown.status,
      message(unknown),
      pick(unknown.body, "params", "schema"),
    ],
    [400, 404, REFUSALS.unknownSchema.key, "nowhere"],
    "tables without a schema is 400, an unknown schema 404",
  );
}

async function assertReferencesCount(api: DataApi): Promise<void> {
  const references = (
    target: string,
    params: Record<string, string>,
  ): Promise<HttpAnswer> => api.browse("references", target, params);
  const summary = (answer: HttpAnswer) =>
    Object.fromEntries(
      objectsAt(answer.body, "items").map((item) => [
        `${text(item.table)}.${text(item.field)}`,
        item.count ?? null,
      ]),
    );
  const order = await references(`${SHOP}.orders`, {
    filter_instance: "is:eu",
    id: "eu_ord_10400",
  });
  assert.deepEqual(
    [summary(order), pick(order.body, "items", 0, "many")],
    [{ "order_items.order_id": 2 }, false],
    "an order is pointed at by two order_items.order_id, not many",
  );
  assert.deepEqual(
    {
      customer: summary(
        await references(CUSTOMERS, {
          filter_instance: "is:eu",
          id: "eu_cus_000",
        }),
      ),
      customerUs: summary(
        await references(CUSTOMERS, {
          filter_instance: "is:us",
          id: "us_cus_001",
        }),
      ),
      product: summary(
        await references(`${SHOP}.products`, {
          filter_instance: "is:eu",
          id: "eu_sku_desk",
        }),
      ),
      defaultProduct: summary(
        await references(`${SHOP}.products`, { id: "sku_desk" }),
      ),
      items: pick(
        (
          await references(`${SHOP}.order_items`, {
            filter_instance: "is:eu",
            id: "eu_itm_0",
          })
        ).body,
        "items",
      ),
    },
    {
      customer: { "orders.customer_id": 4 },
      customerUs: { "orders.customer_id": 4 },
      product: { "order_items.product_id": 27 },
      defaultProduct: { "order_items.product_id": 0 },
      items: [],
    },
    "references count the rows of the same instance only, and a table nothing points to answers an empty list",
  );
  const everywhere = await references(`${SHOP}.orders`, {
    filter_instance: `is:${ALL}`,
    id: "eu_ord_10400",
  });
  assert.equal(everywhere.status, 400, "every instance is refused");
  assert.equal(message(everywhere), REFUSALS.crossInstanceReferences.key);
  assert.deepEqual(
    [
      (await references(`${SHOP}.orders`, { filter_instance: "is:eu" })).status,
      (
        await references(`${SHOP}.orders`, {
          filter_instance: "is:eu",
          id: "nope",
        })
      ).status,
      (await references(`${DEMO}.tags`, { id: "none" })).status,
      (await references(`${DEMO}.posts`, { id: "none" })).status,
    ],
    [400, 404, 404, 404],
    "a missing id is 400, a missing row 404",
  );
  const tagRefs = await references(`${DEMO}.tags`, { id: "follow-up" });
  assert.deepEqual(
    [summary(tagRefs), pick(tagRefs.body, "items", 0, "many")],
    [{ "posts.tag_ids": 0 }, true],
    "a many relation (posts.tag_ids -> tags) is counted with includes",
  );
  assert.ok(
    "comments.post" in
      summary(await references(`${DEMO}.posts`, { id: "first-post" })),
    "a post is pointed at by comments.post",
  );
}

describe("[integration] data journeys: reads", function () {
  this.timeout(LOADED_HOST_TIMEOUT_MS);

  const api = withDataFixture("data-reads-journeys-owner@example.test");

  it("the-selection-decodes-schema-table-and-instance", () =>
    assertSelectionDecoding(api()));
  it("columns-get-and-tables-answer-what-the-grid-needs", async () => {
    await assertColumnsAndTypes(api());
    await assertRowsAndTables(api());
  });
  it("references-count-the-rows-pointing-at-a-row", () =>
    assertReferencesCount(api()));
});
