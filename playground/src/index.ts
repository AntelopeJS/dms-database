import { RegisterSchema } from "@antelopejs/interface-database-decorators";
import "./demo-schema";

export async function start(): Promise<void> {
  await RegisterSchema("demo");
}
