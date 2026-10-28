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

describe("Overview page", () => {
  it("opens on its blocks with no banner", async () => {
    const blocks = [
      DatabaseOverviewPage.connection,
      DatabaseOverviewPage.schemas,
      DatabaseOverviewPage.activity,
    ];
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
