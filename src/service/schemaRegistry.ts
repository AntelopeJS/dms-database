import { Schema } from "@antelopejs/interface-database";

interface SchemaRegistry {
  registry: Map<string, Schema>;
}

// Access the private map of registered schemas kept on the Schema class by the
// database interface. Shared by the introspection and health services so the
// cast lives in one place.
export function getRegistry(): Map<string, Schema> {
  // Reaching into an AntelopeJS internal: the runtime's registry is
  // not on the public type, and the source and target do not overlap,
  // so a single assertion is not expressible.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  return (Schema as unknown as SchemaRegistry).registry;
}
