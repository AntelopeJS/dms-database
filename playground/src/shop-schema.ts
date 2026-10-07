import { Schema } from "@antelopejs/interface-database";
import {
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";

// A storefront with one instance per region, so the data browser, the
// diagram and the query console have relations, nulls, objects and several
// instances to show.

export const SHOP_SCHEMA = "shop";
const REGIONS = ["eu", "us"] as const;
const CUSTOMERS_PER_REGION = 24;
const ORDERS_PER_REGION = 80;
const STATUSES = ["pending", "paid", "refunded", "failed"] as const;
const CHANNELS = ["web", "marketplace", "email", "phone"] as const;
const CARRIERS = ["DHL", "UPS", "La Poste"] as const;
const COMPANIES = [
  "Northwind Traders",
  "Contoso",
  "Fabrikam",
  "Globex",
  "Initech",
  "Umbrella",
  "Hooli",
  "Stark Industries",
] as const;
const DAY_MS = 86_400_000;
const PRODUCTS = [
  ["sku_desk", "Standing desk", 640],
  ["sku_chair", "Task chair", 320],
  ["sku_lamp", "Desk lamp", 48],
  ["sku_monitor", "27-inch monitor", 289],
  ["sku_keyboard", "Mechanical keyboard", 129],
  ["sku_dock", "USB-C dock", 179],
] as const;

@RegisterTable("customers", SHOP_SCHEMA)
export class Customer extends Table {
  declare _id: string;
  @Index() declare email: string;
  declare company: string;
  declare credit_limit: number;
  declare vip: boolean;
}

@RegisterTable("products", SHOP_SCHEMA)
export class Product extends Table {
  declare _id: string;
  @Index() declare name: string;
  declare price: number;
  declare tags: string[];
}

@RegisterTable("orders", SHOP_SCHEMA)
export class Order extends Table {
  declare _id: string;
  @Index() declare number: string;
  @Index() @Relation({ to: () => Customer }) declare customer_id: string;
  @Index({ group: "status_created" }) declare status: string;
  declare channel: string;
  declare total: number;
  declare currency: string;
  declare coupon_id: string | null;
  declare shipping: Record<string, string>;
  @Index({ group: "status_created" }) declare created_at: Date;
}

@RegisterTable("order_items", SHOP_SCHEMA)
export class OrderItem extends Table {
  declare _id: string;
  @Index() @Relation({ to: () => Order }) declare order_id: string;
  @Relation({ to: () => Product }) declare product_id: string;
  declare quantity: number;
  declare unit_price: number;
}

function pick<T>(values: readonly T[], index: number): T {
  return values[index % values.length] as T;
}

function customers(region: string) {
  return Array.from({ length: CUSTOMERS_PER_REGION }, (_, index) => ({
    _id: `${region}_cus_${String(index).padStart(3, "0")}`,
    email: `buyer${index}@${pick(COMPANIES, index).toLowerCase().replace(/\s/g, "")}.test`,
    company: pick(COMPANIES, index),
    credit_limit: 1000 + (index % 5) * 500,
    vip: index % 7 === 0,
  }));
}

function orders(region: string, now: number) {
  return Array.from({ length: ORDERS_PER_REGION }, (_, index) => ({
    _id: `${region}_ord_${10400 + index}`,
    number: `#${10400 + index}`,
    customer_id: `${region}_cus_${String(index % CUSTOMERS_PER_REGION).padStart(3, "0")}`,
    status: pick(STATUSES, index * 3),
    channel: pick(CHANNELS, index),
    total: Math.round((50 + ((index * 137) % 3000)) * 100) / 100,
    currency: region === "eu" ? "EUR" : "USD",
    coupon_id: index % 9 === 0 ? "cpn_AUTUMN10" : null,
    shipping: { carrier: pick(CARRIERS, index), eta: new Date(now + (index % 6) * DAY_MS).toISOString().slice(0, 10) },
    created_at: new Date(now - index * (DAY_MS / 3)),
  }));
}

// Every instance of a table shares one collection on MongoDB: ids are
// prefixed with the region so they never collide.
function productId(region: string | undefined, sku: string): string {
  return region ? `${region}_${sku}` : sku;
}

function orderItems(region: string) {
  return Array.from({ length: ORDERS_PER_REGION * 2 }, (_, index) => {
    const [sku, , price] = pick(PRODUCTS, index);
    return {
      _id: `${region}_itm_${index}`,
      order_id: `${region}_ord_${10400 + Math.floor(index / 2)}`,
      product_id: productId(region, sku),
      quantity: 1 + (index % 3),
      unit_price: price,
    };
  });
}

function products(region?: string) {
  return PRODUCTS.map(([sku, name, price], index) => ({
    _id: productId(region, sku),
    name,
    price,
    tags: index % 2 === 0 ? ["office", "bestseller"] : ["office"],
  }));
}

async function seedTable(
  schema: Schema,
  region: string | undefined,
  table: string,
  rows: Record<string, unknown>[],
) {
  const target = schema.instance(region).table(table as never);
  if ((await target.count()) > 0) return;
  await target.insert(rows as never).run();
}

/** Fills each region of the shop once, on a database that has none of it. */
export async function seedShop(): Promise<void> {
  const schema = Schema.get(SHOP_SCHEMA);
  if (!schema) return;
  const now = Date.now();
  for (const region of REGIONS) {
    await schema.createInstance(region).run().catch(() => undefined);
    await seedTable(schema, region, "customers", customers(region));
    await seedTable(schema, region, "products", products(region));
    await seedTable(schema, region, "orders", orders(region, now));
    await seedTable(schema, region, "order_items", orderItems(region));
  }
  await seedTable(schema, undefined, "products", products());
}
