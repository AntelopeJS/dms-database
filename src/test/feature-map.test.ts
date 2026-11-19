import { strict as assert } from "node:assert";
import { matchesGlob } from "node:path";
import {
  featureMap,
  journeyFeatures,
  repositoryHas,
  trackedFiles,
} from "./helpers/featureMap";

function matchesAny(file: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(file, glob));
}

describe("e2e feature map", () => {
  const { userFacing, notUserFacing, features } = featureMap();

  it("gives every feature a covers list", () => {
    assert.ok(features.length >= 10, `${features.length} features`);
    assert.deepEqual(
      features
        .filter((feature) => feature.covers.length === 0)
        .map((f) => f.name),
      [],
    );
  });

  it("maps every user-facing file to a feature", () => {
    assert.ok(userFacing.length > 0, "e2e/features.json names a surface");
    const covers = features.flatMap((feature) => feature.covers);
    const unmapped = trackedFiles().filter(
      (file) =>
        matchesAny(file, userFacing) &&
        !matchesAny(file, notUserFacing) &&
        !matchesAny(file, covers),
    );
    assert.deepEqual(unmapped, []);
  });

  it("names only docs pages that exist", () => {
    const missing = features.flatMap((feature) =>
      feature.docs
        .filter((page) => !repositoryHas(page))
        .map((page) => `${feature.name}: ${page}`),
    );
    assert.deepEqual(missing, []);
  });

  it("names a feature for every journeys file of the Playwright suite", () => {
    const journeys = journeyFeatures();
    assert.ok(journeys.length >= 10, `${journeys.length} journeys files`);
    const names = new Set(features.map((feature) => feature.name));
    assert.deepEqual(
      journeys.filter((journey) => !names.has(journey)),
      [],
    );
  });
});
