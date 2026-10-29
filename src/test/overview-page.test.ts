import { strict as assert } from "node:assert";
import { DatabaseOverviewPage } from "../pages/overview";

interface SerializedBlock {
  componentName: string;
  children?: { component: SerializedBlock }[];
}

function componentNames(block: SerializedBlock): string[] {
  return [
    block.componentName,
    ...(block.children ?? []).flatMap((child) =>
      componentNames(child.component),
    ),
  ];
}

interface Serializable {
  serialize(): Promise<SerializedBlock>;
}

function isSerializable(value: unknown): value is Serializable {
  return (
    typeof value === "object" &&
    value !== null &&
    "serialize" in value &&
    typeof value.serialize === "function"
  );
}

describe("Overview page", () => {
  it("opens on its blocks with no banner", async () => {
    const blocks = Object.values(DatabaseOverviewPage).filter(isSerializable);
    assert.ok(blocks.length >= 3);
    const names = (
      await Promise.all(blocks.map((block) => block.serialize()))
    ).flatMap(componentNames);
    assert.ok(names.includes("dms-nav-card-grid-block"));
    assert.deepEqual(
      names.filter((name) => name.includes("banner")),
      [],
    );
  });
});
