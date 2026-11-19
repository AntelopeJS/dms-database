import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** Packs the checkout the way a release does, without its lifecycle scripts, and lists the tarball. */
export function packModule(): PackedModule {
  const folder = mkdtempSync(join(tmpdir(), "dms-database-pack-"));
  try {
    const name = execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--silent", "--pack-destination", folder],
      {
        cwd: REPOSITORY,
        encoding: "utf8",
        shell: process.platform === "win32",
      },
    )
      .trim()
      .split("\n")
      .at(-1);
    const tarball = join(folder, name ?? "");
    const files = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim().replace(/^package\//, ""))
      .filter(Boolean);
    const manifest = parseJson(
      execFileSync("tar", ["-xzOf", tarball, "package/package.json"], {
        encoding: "utf8",
      }),
      "the packed package.json",
    );
    return { files, manifest };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
