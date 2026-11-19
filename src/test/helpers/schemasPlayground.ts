import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import {
  EncryptionModifier,
  Encrypted,
  Field,
  HashModifier,
  Hashed,
  Index,
  LocalizationModifier,
  Localized,
  RegisterSchema,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";

/** The schema ids of the Schemas journeys, unique to them. */
export const SHOP = "schemas-journeys-shop";
export const VAULT = "schemas-journeys-vault";
export const LINKS = "schemas-journeys-links";
export const DEMO = "schemas-journeys-demo";
export const METRICS = "schemas-journeys-metrics";
export const QUIRKS = "schemas-journeys-quirks";
export const HOLLOW = "schemas-journeys-hollow";
const REGIONS = ["eu", "us"];
const TENANTS = ["tenant-10", "tenant-2", "tenant-1"];
export const CUSTOMERS_PER_REGION = 3;
export const ORDERS_PER_REGION = 4;
const READINGS = 25;
const SECRET_KEY = "verify-secret-key-0123456789abcd";

@RegisterTable("customers", SHOP)
class SchemasJourneysCustomer extends Table {
  declare _id: string;
  @Index() declare email: string;
  declare company: string;
  declare credit_limit: number;
  declare vip: boolean;
}

@RegisterTable("products", SHOP)
class SchemasJourneysProduct extends Table {
  declare _id: string;
  @Index() declare name: string;
  declare price: number;
  declare tags: string[];
}

@RegisterTable("orders", SHOP)
class SchemasJourneysOrder extends Table {
  declare _id: string;
  @Index() declare number: string;
  @Index()
  @Relation({ to: () => SchemasJourneysCustomer })
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
class SchemasJourneysOrderItem extends Table {
  declare _id: string;
  @Index()
  @Relation({ to: () => SchemasJourneysOrder })
  declare order_id: string;
  @Relation({ to: () => SchemasJourneysProduct }) declare product_id: string;
  declare quantity: number;
  declare unit_price: number;
}

@RegisterTable("accounts", VAULT)
class SchemasJourneysAccount extends Table.with(
  HashModifier,
  EncryptionModifier,
  LocalizationModifier,
) {
  @Field("string") declare _id: string;
  @Index() @Field("string") declare handle: string;
  @Hashed() @Field("string") declare password: string;
  @Encrypted({ secretKey: SECRET_KEY })
  @Field("string")
  declare card_number: string;
  @Localized({ fallbackLocale: "en" })
  @Field("string")
  declare display_name: string;
}

@RegisterTable("parents_registry", VAULT)
class SchemasJourneysParentsRegistry extends Table {
  @Field("string") declare _id: string;
  @Field("string") declare label: string;
}

@RegisterTable("wide_records", VAULT)
class SchemasJourneysWideRecord extends Table {
  @Field("string") declare _id: string;
  @Relation({ to: () => SchemasJourneysParentsRegistry })
  declare registry_id: string;
  @Field("string") declare c01: string;
  @Field("string") declare c02: string;
  @Field("string") declare c03: string;
  @Field("string") declare c04: string;
  @Field("string") declare c05: string;
  @Field("string") declare c06: string;
  @Field("string") declare c07: string;
  @Field("string") declare c08: string;
  @Field("string") declare c09: string;
  @Field("string") declare c10: string;
  @Field("string") declare c11: string;
  @Field("string") declare c12: string;
  @Field("string") declare c13: string;
  @Field("string") declare c14: string;
  @Field("string") declare tail_marker: string;
}

@RegisterTable("customer_refs", LINKS)
class SchemasJourneysCustomerRef extends Table {
  @Field("string") declare _id: string;
  @Relation({ to: () => SchemasJourneysCustomer }) declare customer_id: string;
}

@RegisterTable("tags", DEMO)
class SchemasJourneysTag extends Table {
  declare _id: string;
  @Index() declare name: string;
}

@RegisterTable("posts", DEMO)
class SchemasJourneysPost extends Table {
  declare _id: string;
  @Index() declare title: string;
  @Index() declare author: string;
  declare views: number;
  @Relation({ to: () => SchemasJourneysTag, many: true })
  declare tag_ids: string[];
}

@RegisterTable("readings", METRICS)
class SchemasJourneysReading extends Table {
  @Field("string") declare _id: string;
  @Index() @Field("number") declare seq: number;
  @Field("string") declare band: string;
  @Field("number") declare value: number;
}

@RegisterTable("empty_log", METRICS)
class SchemasJourneysEmptyLog extends Table {
  @Field("string") declare _id: string;
  @Field("string") declare message: string;
}

@RegisterTable("members", QUIRKS)
class SchemasJourneysMember extends Table {
  @Field("string") declare _id: string;
}

/** Keeps the decorated classes referenced: the decorator registers them. */
const TABLES = [
  SchemasJourneysCustomer,
  SchemasJourneysProduct,
  SchemasJourneysOrder,
  SchemasJourneysOrderItem,
  SchemasJourneysAccount,
  SchemasJourneysParentsRegistry,
  SchemasJourneysWideRecord,
  SchemasJourneysCustomerRef,
  SchemasJourneysTag,
  SchemasJourneysPost,
  SchemasJourneysReading,
  SchemasJourneysEmptyLog,
  SchemasJourneysMember,
];

new Schema(HOLLOW, {});

function schema(id: string) {
  const found = Schema.get(id);
  assert.ok(found, `${id} is registered`);
  return found;
}

const PRODUCTS = [
  ["sku_desk", "Standing desk", 640],
  ["sku_chair", "Task chair", 320],
  ["sku_lamp", "Desk lamp", 48],
  ["sku_monitor", "27-inch monitor", 289],
  ["sku_keyboard", "Mechanical keyboard", 129],
  ["sku_dock", "USB-C dock", 179],
] as const;

function products(region?: string) {
  return PRODUCTS.map(([sku, name, price], index) => ({
    _id: region ? `${region}_${sku}` : sku,
    name,
    price,
    tags: index % 2 === 0 ? ["office", "bestseller"] : ["office"],
  }));
}

async function seedShop(): Promise<void> {
  const shop = schema(SHOP);
  for (const region of REGIONS) {
    await shop
      .createInstance(region)
      .run()
      .catch(() => undefined);
    const tables = shop.instance(region);
    await tables
      .table("customers")
      .insert(
        Array.from({ length: CUSTOMERS_PER_REGION }, (_, index) => ({
          _id: `${region}_cus_${index}`,
          email: `buyer${index}@${region}.test`,
          company: `Company ${index}`,
          credit_limit: 1000 + index * 500,
          vip: index === 0,
        })),
      )
      .run();
    await tables.table("products").insert(products(region)).run();
    await tables
      .table("orders")
      .insert(
        Array.from({ length: ORDERS_PER_REGION }, (_, index) => ({
          _id: `${region}_ord_${index}`,
          number: `#${10400 + index}`,
          customer_id: `${region}_cus_${index % CUSTOMERS_PER_REGION}`,
          status: index % 2 === 0 ? "paid" : "pending",
          channel: "web",
          total: 50 + index,
          currency: region === "eu" ? "EUR" : "USD",
          coupon_id: index === 0 ? "cpn_AUTUMN10" : null,
          shipping: { carrier: "DHL", eta: "2026-11-20" },
          created_at: new Date(Date.UTC(2026, 10, 1 + index)),
        })),
      )
      .run();
    await tables
      .table("order_items")
      .insert(
        Array.from({ length: ORDERS_PER_REGION * 2 }, (_, index) => ({
          _id: `${region}_itm_${index}`,
          order_id: `${region}_ord_${Math.floor(index / 2)}`,
          product_id: `${region}_${PRODUCTS[index % PRODUCTS.length]?.[0]}`,
          quantity: 1 + (index % 3),
          unit_price: 48,
        })),
      )
      .run();
  }
  await shop.instance().table("products").insert(products()).run();
}

/**
 * Registers the schemas of the Schemas journeys and fills them: a shop with an `eu` and a `us` instance, a vault
 * with modifiers and a seventeen-column table, links with three tenants and a relation to the shop, demo posts,
 * metrics readings, a `constructor` column and a schema without a table.
 */
export async function seed(): Promise<void> {
  assert.equal(TABLES.length, 13);
  for (const id of [SHOP, VAULT, LINKS, DEMO, METRICS, QUIRKS])
    await RegisterSchema(id);
  await seedShop();
  const vault = schema(VAULT).instance();
  await vault
    .table("accounts")
    .insert(
      ["ada", "bob"].map((handle) => ({
        _id: `acc_${handle}`,
        handle,
        password: "hashed",
        card_number: "sealed",
        display_name: handle,
      })),
    )
    .run();
  await vault
    .table("parents_registry")
    .insert([{ _id: "reg_1", label: "registry one" }])
    .run();
  await vault
    .table("wide_records")
    .insert([
      { _id: "wide_1", registry_id: "reg_1", c01: "a", tail_marker: "tail" },
    ])
    .run();
  for (const tenant of TENANTS)
    await schema(LINKS)
      .createInstance(tenant)
      .run()
      .catch(() => undefined);
  await schema(DEMO)
    .instance()
    .table("posts")
    .insert(
      ["First", "Second", "Third"].map((title, index) => ({
        _id: `post_${index}`,
        title: `${title} post`,
        author: index === 1 ? "bob" : "alice",
        views: index * 10,
        tag_ids: [],
      })),
    )
    .run();
  await schema(METRICS)
    .instance()
    .table("readings")
    .insert(
      Array.from({ length: READINGS }, (_, index) => ({
        _id: `r_${index + 1}`,
        seq: index + 1,
        band: `band-${(index % 5) + 1}`,
        value: index * 7,
      })),
    )
    .run();
  await schema(QUIRKS)
    .instance()
    .table("members")
    .insert([
      Object.fromEntries([
        ["_id", "member_1"],
        ["constructor", "ctor value"],
        ["note", "plain column"],
      ]),
    ])
    .run();
}

/** Removes what {@link seed} stored. */
export async function cleanUp(): Promise<void> {
  for (const region of REGIONS)
    await schema(SHOP).destroyInstance(region).run();
  for (const tenant of TENANTS)
    await schema(LINKS).destroyInstance(tenant).run();
  const tables: [string, string][] = [
    [SHOP, "products"],
    [VAULT, "accounts"],
    [VAULT, "parents_registry"],
    [VAULT, "wide_records"],
    [DEMO, "posts"],
    [METRICS, "readings"],
    [QUIRKS, "members"],
  ];
  for (const [id, table] of tables)
    await schema(id).instance().table(table).delete().run();
}

const figures = (rows: number, columns: number, indexes: number) => ({
  rows,
  columns,
  indexes,
  relations: [],
  modifiers: [],
});

/** What the source route answers for ten tables of {@link seed}: rows in the default instance, column, index and relation counts, the tables each points to and its modifier names. */
export const EXPECTED_FIGURES = [
  [`${SHOP}::customers`, figures(0, 5, 1)],
  [`${SHOP}::products`, figures(6, 4, 1)],
  [`${SHOP}::orders`, { ...figures(0, 10, 3), relations: ["customers"] }],
  [
    `${SHOP}::order_items`,
    { ...figures(0, 5, 1), relations: ["orders", "products"] },
  ],
  [
    `${VAULT}::accounts`,
    { ...figures(2, 5, 1), modifiers: ["Hashed", "Encrypted", "Localized"] },
  ],
  [
    `${VAULT}::wide_records`,
    { ...figures(1, 17, 0), relations: ["parents_registry"] },
  ],
  [
    `${LINKS}::customer_refs`,
    { ...figures(0, 2, 0), relations: [`${SHOP}.customers`] },
  ],
  [`${DEMO}::posts`, { ...figures(3, 5, 2), relations: ["tags"] }],
  [`${METRICS}::readings`, figures(READINGS, 4, 1)],
  [`${METRICS}::empty_log`, figures(0, 2, 0)],
] as const;
