import { RegisterSchema } from "@antelopejs/interface-database-decorators";
import "./demo-schema";
import { SHOP_SCHEMA, seedShop } from "./shop-schema";

export async function start(): Promise<void> {
  await RegisterSchema("demo");
  await RegisterSchema(SHOP_SCHEMA);
  await seedShop();
}
