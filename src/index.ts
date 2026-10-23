import "./db";
import "./module";
import { RegisterSchema } from "@antelopejs/interface-database-decorators";
import { AddFrontendModule } from "@antelopejs/interface-dms/page";
import {
  registerAutomationNodes,
  unregisterAutomationNodes,
} from "./automation";
import { type DmsDatabaseConfig, setModuleConfig } from "./config";
import { SCHEMA_NAME } from "./types/constants";
import { frontendModule } from "./frontend-module";

export type { DmsDatabaseConfig } from "./config";
export * from "./pages";
export * from "./routes";

export async function construct(config?: DmsDatabaseConfig): Promise<void> {
  setModuleConfig(config);
  await AddFrontendModule(frontendModule());
}

export async function start(): Promise<void> {
  await RegisterSchema(SCHEMA_NAME);
  registerAutomationNodes();
}

export function stop(): void {
  unregisterAutomationNodes();
}
