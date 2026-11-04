import { Schema } from "@antelopejs/interface-database";

/** The schemas this process defined, by ID, as the introspection and health services read them. */
export function getRegistry(): ReadonlyMap<string, Schema> {
  return Schema.list();
}
