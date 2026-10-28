import { Schema } from "@antelopejs/interface-database";

/**
 * Access the private map of registered schemas kept on the Schema class by the
 * database interface. Shared by the introspection and health services so the
 * access lives in one place.
 */
export function getRegistry(): Map<string, Schema> {
  return Schema["registry"];
}
