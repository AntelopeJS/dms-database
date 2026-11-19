import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  isBoolean,
  isFiniteNumber,
  isRecord,
  isString,
} from "../../utils/guards";

/** The root of the checkout the test build runs from. */
export const REPOSITORY = resolve(__dirname, "..", "..", "..");

/** A parsed JSON value. */
export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json };

/** What `npm pack` would publish: the paths in the tarball and its manifest. */
export interface PackedModule {
  readonly files: readonly string[];
  readonly manifest: Json;
}

function isJson(value: unknown): value is Json {
  if (
    value === null ||
    isString(value) ||
    isBoolean(value) ||
    isFiniteNumber(value)
  )
    return true;
  if (Array.isArray(value)) return value.every(isJson);
  return isRecord(value) && Object.values(value).every(isJson);
}

function isJsonArray(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function parseJson(source: string, origin: string): Json {
  const value: unknown = JSON.parse(source);
  if (!isJson(value)) throw new Error(`${origin} holds no JSON value`);
  return value;
}

/**
 * The text of a file of the checkout.
 *
 * @param file The path from the repository root
 */
export function repositoryText(file: string): string {
  return readFileSync(join(REPOSITORY, file), "utf8");
}

/**
 * The parsed JSON of a file of the checkout.
 *
 * @param file The path from the repository root
 */
export function repositoryJson(file: string): Json {
  return parseJson(repositoryText(file), file);
}

/** What `npm pack` would put in the tarball, listed without writing it, and the manifest it packs. */
export function packModule(): PackedModule {
  const report = parseJson(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: REPOSITORY,
      encoding: "utf8",
      shell: process.platform === "win32",
    }),
    "npm pack --json",
  );
  const entry = isJsonArray(report) ? report.at(0) : undefined;
  const listed = isRecord(entry) ? entry["files"] : undefined;
  const files = (isJsonArray(listed) ? listed : []).flatMap((file) =>
    isRecord(file) && isString(file["path"]) ? [file["path"]] : [],
  );
  return { files, manifest: repositoryJson("package.json") };
}
