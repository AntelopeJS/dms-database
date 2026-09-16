import "./db";
import path from "node:path";
import { RegisterSchema } from "@antelopejs/interface-database-decorators";
import {
  AddFrontendModule,
  RegisterModule,
} from "@antelopejs/interface-dms/page";
import {
  registerAutomationNodes,
  unregisterAutomationNodes,
} from "./automation";
import { type DmsDatabaseConfig, setModuleConfig } from "./config";
import { SCHEMA_NAME } from "./types/constants";

RegisterModule({
  id: "database",
  title: "$dms_database.title",
  description: "$dms_database.description",
  icon: "i-ph-database",
  landingPage: "overview",
});

export type { DmsDatabaseConfig } from "./config";
export * from "./pages";
export * from "./routes";

export async function construct(config?: DmsDatabaseConfig): Promise<void> {
  setModuleConfig(config);
  await AddFrontendModule({
    name: "@antelopejs/dms-database-frontend-vue",
    sourcePath: path.join(__dirname, "../frontend-vue"),
    renderer: { name: "vue", version: "3" },
    configKey: "dmsDatabase",
    priority: 0,
  });
}

export async function start(): Promise<void> {
  await RegisterSchema(SCHEMA_NAME);
  registerAutomationNodes();
}

export function stop(): void {
  unregisterAutomationNodes();
}
