import { strict as assert } from "node:assert";
import { matchesGlob } from "node:path";
import {
  features,
  journeyIds,
  repositoryHas,
  surface,
  trackedFiles,
} from "./helpers/featureMap";

function matchesAny(file: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(file, glob));
}

describe("Verify skill feature map", () => {
  const map = features();

  it("reads a covers list from every feature file", () => {
    assert.ok(map.length >= 10, `${map.length} feature files`);
    assert.deepEqual(
      map.filter((feature) => feature.covers.length === 0).map((f) => f.file),
      [],
    );
  });

  it("maps every user-facing file to a feature", () => {
    const { userFacing, notUserFacing } = surface();
    assert.ok(userFacing.length > 0, "verify.config.ts names a surface");
    const covers = map.flatMap((feature) => feature.covers);
    const unmapped = trackedFiles().filter(
      (file) =>
        matchesAny(file, userFacing) &&
        !matchesAny(file, notUserFacing) &&
        !matchesAny(file, covers),
    );
    assert.deepEqual(unmapped, []);
  });

  it("names only docs pages that exist", () => {
    const missing = map.flatMap((feature) =>
      feature.docs
        .filter((page) => !repositoryHas(page))
        .map((page) => `${feature.file}: ${page}`),
    );
    assert.deepEqual(missing, []);
  });

  it("names every journey of the Playwright suite in a feature file", () => {
    const ids = journeyIds();
    assert.ok(ids.length > 100, `${ids.length} journeys`);
    assert.deepEqual(
      ids.filter((id) => !map.some((feature) => feature.text.includes(id))),
      [],
    );
  });
});
