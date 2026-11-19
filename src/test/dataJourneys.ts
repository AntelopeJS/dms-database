import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import {
  Field,
  Index,
  RegisterSchema,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import type { JsonObject, JsonValue } from "../types/json";
import { isString } from "../utils/guards";
import { callDatabase, type HttpAnswer } from "./helpers/http";
import { objectsAt, pick } from "./helpers/pick";
import { createOwnerSession, type OwnerSession } from "./ownerSession";

/**
 * The data the data journeys read, as the e2e playground's `shop`, `metrics` and `demo` schemas hold it: a shop with
 * an `eu` and a `us` instance and products in its default one, 1,250 readings and an empty table, and posts whose
 * tags and comments point at them.
 */
export const SHOP = "data-journeys-shop";
export const METRICS = "data-journeys-metrics";
export const DEMO = "data-journeys-demo";
export const ALL = "__CROSS_INSTANCE__";
export const READINGS = `${METRICS}.readings`;
export const CUSTOMERS = `${SHOP}.customers`;
const REGIONS = ["eu", "us"] as const;
const CUSTOMERS_PER_REGION = 24;
const ORDERS_PER_REGION = 80;
const READING_COUNT = 1250;
const STATUSES = ["pending", "paid", "refunded", "failed"] as const;
const CHANNELS = ["web", "marketplace", "email", "phone"] as const;
const CARRIERS = ["DHL", "UPS", "La Poste"] as const;
const COMPANIES = ["Northwind Traders", "Contoso", "Fabrikam", "Globex"];
const DAY_MS = 86_400_000;
const PRODUCTS = [
  ["sku_desk", "Standing desk", 640],
  ["sku_chair", "Task chair", 320],
  ["sku_lamp", "Desk lamp", 48],
  ["sku_monitor", "27-inch monitor", 289],
  ["sku_keyboard", "Mechanical keyboard", 129],
  ["sku_dock", "USB-C dock", 179],
] as const;

@RegisterTable("customers", SHOP)
class DataJourneysCustomer extends Table {
  declare _id: string;
  @Index() declare email: string;
  declare company: string;
  declare credit_limit: number;
  declare vip: boolean;
}

@RegisterTable("products", SHOP)
class DataJourneysProduct extends Table {
  declare _id: string;
  @Index() declare name: string;
  declare price: number;
  declare tags: string[];
}

@RegisterTable("orders", SHOP)
class DataJourneysOrder extends Table {
  declare _id: string;
  @Index() declare number: string;
  @Index()
  @Relation({ to: () => DataJourneysCustomer })
  declare customer_id: string;
  @Index({ group: "status_created" }) declare status: string;
  declare channel: string;
  declare total: number;
  declare currency: string;
  declare coupon_id: string | null;
  declare shipping: Record<string, string>;
  @Index({ group: "status_created" }) declare created_at: Date;
}

@RegisterTable("order_items", SHOP)
class DataJourneysOrderItem extends Table {
  declare _id: string;
  @Index() @Relation({ to: () => DataJourneysOrder }) declare order_id: string;
  @Relation({ to: () => DataJourneysProduct }) declare product_id: string;
  declare quantity: number;
  declare unit_price: number;
}

@RegisterTable("readings", METRICS)
class DataJourneysReading extends Table {
  @Field("string") declare _id: string;
  @Index() @Field("number") declare seq: number;
  @Field("string") declare band: string;
  @Field("number") declare value: number;
}

@RegisterTable("empty_log", METRICS)
class DataJourneysEmptyLog extends Table {
  @Field("string") declare _id: string;
  @Field("string") declare message: string;
}

@RegisterTable("tags", DEMO)
class DataJourneysTag extends Table {
  declare _id: string;
  @Index() declare name: string;
}

@RegisterTable("posts", DEMO)
class DataJourneysPost extends Table {
  declare _id: string;
  @Index() declare title: string;
  @Relation({ to: () => DataJourneysTag, many: true })
  declare tag_ids: string[];
}

@RegisterTable("comments", DEMO)
class DataJourneysComment extends Table {
  declare _id: string;
  @Index() @Relation({ to: () => DataJourneysPost }) declare post: string;
  declare body: string;
}

/** Keeps the decorated classes referenced: the decorators register them. */
const TABLES = [
  DataJourneysCustomer,
  DataJourneysProduct,
  DataJourneysOrder,
  DataJourneysOrderItem,
  DataJourneysReading,
  DataJourneysEmptyLog,
  DataJourneysTag,
  DataJourneysPost,
  DataJourneysComment,
];

function cycle<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length];
  assert.ok(value !== undefined);
  return value;
}

function customerId(region: string, index: number): string {
  return `${region}_cus_${String(index % CUSTOMERS_PER_REGION).padStart(3, "0")}`;
}

function productId(region: string | undefined, sku: string): string {
  return region ? `${region}_${sku}` : sku;
}

function products(region?: string) {
  return PRODUCTS.map(([sku, name, price], index) => ({
    _id: productId(region, sku),
    name,
    price,
    tags: index % 2 === 0 ? ["office", "bestseller"] : ["office"],
  }));
}

/** The rows of one region of the shop: every order has two items, the n-th customer every 24th order. */
function region(name: string, now: number) {
  return {
    customers: Array.from({ length: CUSTOMERS_PER_REGION }, (_, index) => ({
      _id: customerId(name, index),
      email: `buyer${index}@shop.test`,
      company: cycle(COMPANIES, index),
      credit_limit: 1000 + (index % 5) * 500,
      vip: index % 7 === 0,
    })),
    products: products(name),
    orders: Array.from({ length: ORDERS_PER_REGION }, (_, index) => ({
      _id: `${name}_ord_${10400 + index}`,
      number: `#${10400 + index}`,
      customer_id: customerId(name, index),
      status: cycle(STATUSES, index * 3),
      channel: cycle(CHANNELS, index),
      total: 50 + ((index * 137) % 3000),
      currency: name === "eu" ? "EUR" : "USD",
      coupon_id: index % 9 === 0 ? "cpn_AUTUMN10" : null,
      shipping: { carrier: cycle(CARRIERS, index) },
      created_at: new Date(now - index * DAY_MS),
    })),
    order_items: Array.from({ length: ORDERS_PER_REGION * 2 }, (_, index) => {
      const [sku, , price] = cycle(PRODUCTS, index);
      return {
        _id: `${name}_itm_${index}`,
        order_id: `${name}_ord_${10400 + Math.floor(index / 2)}`,
        product_id: productId(name, sku),
        quantity: 1 + (index % 3),
        unit_price: price,
      };
    }),
  };
}

function registered(id: string) {
  const schema = Schema.get(id);
  assert.ok(schema, `${id} is registered`);
  return schema;
}

async function seed(): Promise<void> {
  assert.equal(TABLES.length, 9);
  for (const id of [SHOP, METRICS, DEMO]) await RegisterSchema(id);
  const shop = registered(SHOP);
  const now = Date.now();
  for (const name of REGIONS) {
    await shop
      .createInstance(name)
      .run()
      .catch(() => undefined);
    for (const [table, rows] of Object.entries(region(name, now))) {
      await shop.instance(name).table(table).insert(rows).run();
    }
  }
  await shop.instance().table("products").insert(products()).run();
  await registered(METRICS)
    .instance()
    .table("readings")
    .insert(
      Array.from({ length: READING_COUNT }, (_, index) => ({
        _id: `r_${String(index + 1).padStart(4, "0")}`,
        seq: index + 1,
        band: `band-${(index % 5) + 1}`,
        value: (index * 7) % 101,
      })),
    )
    .run();
  const demo = registered(DEMO).instance();
  await demo
    .table("tags")
    .insert(["intro", "follow-up", "rant"].map((name) => ({ _id: name, name })))
    .run();
  await demo
    .table("posts")
    .insert([
      { _id: "first-post", title: "First post", tag_ids: [] },
      { _id: "second-post", title: "Second post", tag_ids: [] },
    ])
    .run();
  await demo
    .table("comments")
    .insert([
      { _id: "c1", post: "first-post", body: "Nice!" },
      { _id: "c2", post: "first-post", body: "Agreed." },
    ])
    .run();
}

async function unseed(): Promise<void> {
  const shop = registered(SHOP);
  for (const name of REGIONS) await shop.destroyInstance(name).run();
  for (const [id, tables] of [
    [SHOP, ["customers", "products", "orders", "order_items"]],
    [METRICS, ["readings", "empty_log"]],
    [DEMO, ["tags", "posts", "comments"]],
  ] as const) {
    for (const table of tables) {
      await registered(id).instance().table(table).delete().run();
    }
  }
}

/** The browse API as the owner of a seeded data fixture calls it. */
export interface DataApi {
  /** Calls a browse route on `schema.table` (or `schema`), with `params` after the selection. */
  browse(
    route: string,
    target: string,
    params?: Record<string, string | number>,
  ): Promise<HttpAnswer>;
  /** Calls `path` under `/api/database`. */
  get(path: string): Promise<HttpAnswer>;
}

/**
 * Seeds the fixture before the suite it is called in and removes it after, and gives its journeys the browse API
 * as an owner signed in for the suite.
 */
export function withDataFixture(email: string): () => DataApi {
  let owner: OwnerSession | undefined;
  before(async () => {
    await seed();
    owner = await createOwnerSession(email);
  });
  after(async () => {
    await owner?.remove();
    await unseed();
  });
  return () => {
    const session = owner;
    assert.ok(session, "the suite's before hook signed the owner in");
    return {
      browse(route, target, params = {}) {
        const [schema = "", table] = target.split(".");
        const query = new URLSearchParams({ filter_schema: `is:${schema}` });
        if (table !== undefined) query.set("filter_table", `is:${table}`);
        for (const [key, value] of Object.entries(params)) {
          query.set(key, String(value));
        }
        return callDatabase(
          session,
          "GET",
          `/browse/${route}?${query.toString()}`,
        );
      },
      get(path) {
        return callDatabase(session, "GET", path);
      },
    };
  };
}

/** The rows a list route answered. */
export function rowsOf(answer: HttpAnswer): JsonObject[] {
  return objectsAt(answer.body, "results");
}

/** One cell of each row a list route answered, `null` where the row has none. */
export function column(answer: HttpAnswer, name: string): JsonValue[] {
  return rowsOf(answer).map((row) => row[name] ?? null);
}

/** The message of a refusal: its text body, or the `message` of its JSON body. */
export function message(answer: HttpAnswer): string {
  if (isString(answer.body)) return answer.body;
  const field = pick(answer.body, "message");
  return isString(field) ? field : answer.text;
}
