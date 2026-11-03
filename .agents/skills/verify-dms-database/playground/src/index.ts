import { RegisterSchema } from "@antelopejs/interface-database-decorators";
import "./demo-schema";
import "./fixture";
import { LABEL_SCHEMAS } from "./labels-schema";
import { METRICS_SCHEMA, seedMetrics } from "./metrics-schema";
import { SHOP_SCHEMA, seedShop } from "./shop-schema";
import { VAULT_SCHEMA, seedVault } from "./vault-schema";

export async function start(): Promise<void> {
  await RegisterSchema("demo");
  await RegisterSchema(SHOP_SCHEMA);
  await RegisterSchema(VAULT_SCHEMA);
  await RegisterSchema(METRICS_SCHEMA);
  for (const schema of LABEL_SCHEMAS) await RegisterSchema(schema);
  await seedShop();
  await seedVault();
  await seedMetrics();
}
