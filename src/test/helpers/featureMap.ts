import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPOSITORY, repositoryText } from "./repository";

const SKILL = ".agents/skills/verify-dms-database";
const FEATURES = `${SKILL}/features`;
const JOURNEYS = "e2e/journeys";

/** One feature file of the verify skill: the source globs it owns, its docs pages and its text. */
export interface Feature {
  readonly file: string;
  readonly covers: readonly string[];
  readonly docs: readonly string[];
  readonly text: string;
}

/** The user-facing globs of `verify.config.ts`, and the globs it excludes from them. */
export interface Surface {
  readonly userFacing: readonly string[];
  readonly notUserFacing: readonly string[];
}

function frontmatterList(text: string, key: string): string[] {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const block = new RegExp(`^${key}:\\n((?:  - .*\\n?)*)`, "m").exec(
    frontmatter,
  )?.[1];
  return (block ?? "")
    .split("\n")
    .map((line) => line.replace(/^ {2}- /, "").trim())
    .filter(Boolean);
}

/** Every feature file but the README, with its `covers:` and `docs:` lists. */
export function features(): Feature[] {
  return readdirSync(join(REPOSITORY, FEATURES))
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort()
    .map((file) => {
      const text = repositoryText(`${FEATURES}/${file}`);
      return {
        file,
        covers: frontmatterList(text, "covers"),
        docs: frontmatterList(text, "docs"),
        text,
      };
    });
}

/** The user-facing surface `verify.config.ts` declares. */
export function surface(): Surface {
  const config = repositoryText(`${SKILL}/verify.config.ts`);
  const globs = (key: string): string[] =>
    [
      ...(
        new RegExp(`^\\s*${key}: \\[(.*)\\],$`, "m").exec(config)?.[1] ?? ""
      ).matchAll(/"([^"]+)"/g),
    ].map((match) => match[1] ?? "");
  return {
    userFacing: globs("userFacing"),
    notUserFacing: globs("notUserFacing"),
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

/** The id of every journey the Playwright suite registers, from `e2e/journeys` and its parts. */
export function journeyIds(): string[] {
  const files = readdirSync(join(REPOSITORY, JOURNEYS), {
    recursive: true,
    encoding: "utf8",
  }).filter((file) => file.endsWith(".mjs"));
  return files.flatMap((file) =>
    [
      ...repositoryText(`${JOURNEYS}/${file}`).matchAll(
        /^\s+id: "([a-z0-9-]+)",$/gm,
      ),
    ].map((match) => match[1] ?? ""),
  );
}
