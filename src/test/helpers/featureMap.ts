import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isRecord, isString } from "../../utils/guards";
import { REPOSITORY, repositoryJson } from "./repository";

const MAP = "e2e/features.json";
const JOURNEYS = "e2e/journeys";

/** One feature of `e2e/features.json`: the source globs it owns and its docs pages. */
export interface Feature {
  readonly name: string;
  readonly covers: readonly string[];
  readonly docs: readonly string[];
}

/** `e2e/features.json`: the user-facing globs, the globs excluded from them, and the features. */
export interface FeatureMap {
  readonly userFacing: readonly string[];
  readonly notUserFacing: readonly string[];
  readonly features: readonly Feature[];
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isFeature(
  value: unknown,
): value is { covers: string[]; docs: string[] } {
  return (
    isRecord(value) &&
    isStringList(value["covers"]) &&
    isStringList(value["docs"])
  );
}

/** The parsed `e2e/features.json`; throws on a key of the wrong shape. */
export function featureMap(): FeatureMap {
  const map = repositoryJson(MAP);
  if (
    !isRecord(map) ||
    !isStringList(map["userFacing"]) ||
    !isStringList(map["notUserFacing"]) ||
    !isRecord(map["features"])
  )
    throw new Error(`${MAP}: userFacing, notUserFacing or features is missing`);
  return {
    userFacing: map["userFacing"],
    notUserFacing: map["notUserFacing"],
    features: Object.entries(map["features"]).map(([name, feature]) => {
      if (!isFeature(feature))
        throw new Error(`${MAP}: ${name} needs covers and docs lists`);
      return { name, covers: feature.covers, docs: feature.docs };
    }),
  };
}

/** The files git tracks in the checkout, as paths from its root. */
export function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], {
    cwd: REPOSITORY,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

/** Whether a path exists from the repository root. */
export function repositoryHas(path: string): boolean {
  return existsSync(join(REPOSITORY, path));
}

/** The feature each `e2e/journeys/<feature>.mjs` file names, its helpers in subfolders left out. */
export function journeyFeatures(): string[] {
  return readdirSync(join(REPOSITORY, JOURNEYS))
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => file.replace(/\.mjs$/, ""))
    .sort();
}
