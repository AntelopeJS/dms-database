import { RegisterSchema } from "@antelopejs/interface-database-decorators";
import "./demo-schema";
import { startBridgeSchemas } from "./bridge-schema";
import { seedBrowseFixtures } from "./browse-fixtures";
import "./fixture";
import { MODS_SCHEMA } from "./mods-schema";
import { LABEL_SCHEMAS } from "./labels-schema";
import { METRICS_SCHEMA, seedMetrics } from "./metrics-schema";
import { SHOP_SCHEMA, seedShop } from "./shop-schema";
import { VAULT_SCHEMA, seedVault } from "./vault-schema";

export async function start(): Promise<void> {
  await RegisterSchema("demo");
  await RegisterSchema(SHOP_SCHEMA);
  await RegisterSchema(VAULT_SCHEMA);
  await RegisterSchema(METRICS_SCHEMA);
  await RegisterSchema(MODS_SCHEMA);
  for (const schema of LABEL_SCHEMAS) await RegisterSchema(schema);
  await startBridgeSchemas();
  await seedShop();
  await seedVault();
  await seedMetrics();
  await seedBrowseFixtures();
}
