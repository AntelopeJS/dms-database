import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { check, isRow, isText, parseJson, pick } from "../database.mjs";

/** @typedef {import("../database.mjs").Ctx} Ctx */

/**
 * Packs the module the way a release would and lists the tarball.
 *
 * @param {Ctx} ctx The journey
 * @returns {{ files: string[], manifest: unknown }} The packed paths and the packed manifest
 */
function packed(ctx) {
  const folder = mkdtempSync(join(tmpdir(), "verify-dms-database-pack-"));
  try {
    const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--silent", "--pack-destination", folder], { cwd: ctx.state.repo ?? ".", encoding: "utf8" });
    const tarball = join(folder, pack.stdout.trim().split("\n").at(-1) ?? "");
    const listed = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" });
    const manifest = parseJson(spawnSync("tar", ["-xzOf", tarball, "package/package.json"], { encoding: "utf8" }).stdout);
    return { files: listed.stdout.split("\n").map((line) => line.replace(/^package\//, "")).filter(Boolean), manifest };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} file A file of the checkout
 * @returns {string} Its text
 */
function read(ctx, file) {
  return readFileSync(join(ctx.state.repo ?? ".", file), "utf8");
}

/**
 * The leaf keys of a locale file, as dotted paths.
 *
 * @param {unknown} node A locale object
 * @param {string} [prefix] The path so far
 * @returns {string[]} The sorted paths
 */
function leafKeys(node, prefix = "") {
  if (!isRow(node)) return [prefix];
  return Object.entries(node).flatMap(([key, value]) => leafKeys(value, prefix ? `${prefix}.${key}` : key)).sort();
}

/** What a project installs from the registry, and the ranges the README names. */
export const journeys = guarded([
  {
    id: "the-tarball-holds-what-its-manifest-names",
    title: "the package tarball holds the build, the dashboard layer with both locales and the agent skill, every path the manifest points at, without test build or build info and without the docs",
    entryPoint: "npm pack of the module",
    database: "shared",
    onboard: false,
    async run(/** @type {Ctx} */ ctx) {
      const { files, manifest } = packed(ctx);
      const targets = [pick(manifest, "main"), pick(manifest, "types"), pick(manifest, "exports", ".", "types"), pick(manifest, "exports", ".", "default"), pick(manifest, "dmsFrontend")].map((target) => String(target).replace(/^\.\//, ""));
      await ctx.verify("the packed module", [
        ...targets.map((target) => check(`${target} is packed`, files.includes(target), target)),
        check("the manifest names the module", pick(manifest, "name") === "@antelopejs/dms-database", pick(manifest, "name")),
        check("the skill ships and is declared", JSON.stringify(pick(manifest, "antelopeJs", "skills")) === JSON.stringify(["./skills"]) && files.includes("skills/dms-database/SKILL.md") && files.includes("skills/dms-database/cases.json"), files.filter((file) => file.startsWith("skills/"))),
        check("the dashboard layer ships with both locales", files.includes("frontend-vue/dms.frontend.ts") && files.includes("frontend-vue/i18n/locales/database-en-GB.json") && files.includes("frontend-vue/i18n/locales/database-fr-FR.json"), files.filter((file) => file.includes("locales"))),
        check("the layer's pages and components ship", files.includes("frontend-vue/app/components/DataBrowser.vue") && files.includes("frontend-vue/app/components/QueryConsole.vue") && files.includes("frontend-vue/app/components/SchemaDiagram.vue") && files.includes("frontend-vue/app/components/TableInspector.vue") && files.includes("frontend-vue/app/components/ConnectionStatus.vue"), files.filter((file) => file.startsWith("frontend-vue/app/components/")).length),
        check("no test build, no build info", !files.some((file) => file.startsWith("dist/test/") || file.endsWith(".tsbuildinfo")), files.filter((file) => file.includes("test") || file.endsWith(".tsbuildinfo"))),
        check("the docs are not packed", !files.some((file) => file.startsWith("docs/")), files.filter((file) => file.startsWith("docs/"))),
        check("public access", pick(manifest, "publishConfig", "access") === "public", pick(manifest, "publishConfig")),
      ]);
    },
  },
  {
    id: "both-locales-hold-the-same-texts",
    title: "the English and French locale files hold exactly the same keys, none empty, so every string exists in both languages",
    entryPoint: "frontend-vue/i18n/locales/database-en-GB.json and database-fr-FR.json",
    database: "shared",
    onboard: false,
    async run(/** @type {Ctx} */ ctx) {
      const english = parseJson(read(ctx, "frontend-vue/i18n/locales/database-en-GB.json"));
      const french = parseJson(read(ctx, "frontend-vue/i18n/locales/database-fr-FR.json"));
      const [englishKeys, frenchKeys] = [leafKeys(english), leafKeys(french)];
      const missingInFrench = englishKeys.filter((key) => !frenchKeys.includes(key));
      const missingInEnglish = frenchKeys.filter((key) => !englishKeys.includes(key));
      /** @param {unknown} locale @param {string[]} keys @returns {string[]} */
      const empty = (locale, keys) =>
        keys.filter((key) => {
          const value = key.split(".").reduce((node, step) => pick(node, step), locale);
          return !isText(value) || value.trim() === "";
        });
      await ctx.verify("the locales", [
        check("every English key exists in French", missingInFrench.length === 0, missingInFrench),
        check("every French key exists in English", missingInEnglish.length === 0, missingInEnglish),
        check("no English text is empty", empty(english, englishKeys).length === 0, empty(english, englishKeys)),
        check("no French text is empty", empty(french, frenchKeys).length === 0, empty(french, frenchKeys)),
      ]);
    },
  },
  {
    id: "ranges-match-the-compatibility-table",
    title: "the README compatibility table lists the interface ranges the module depends on, the dashboard layer pins one renderer minor, and the README names the same renderer cap as the layer's engines",
    entryPoint: "README.md, package.json, frontend-vue/package.json",
    database: "shared",
    onboard: false,
    async run(/** @type {Ctx} */ ctx) {
      const readme = read(ctx, "README.md");
      const table = new Map([...readme.matchAll(/^\| `(@antelopejs\/[^`]+)`\s*\| `([^`]+)`/gm)].map((match) => [match[1] ?? "", match[2] ?? ""]));
      const module = parseJson(read(ctx, "package.json"));
      const frontend = parseJson(read(ctx, "frontend-vue/package.json"));
      const dependencies = pick(module, "dependencies");
      const optional = pick(module, "optionalDependencies");
      const interfaces = [...(isRow(dependencies) ? Object.entries(dependencies) : []), ...(isRow(optional) ? Object.entries(optional) : [])].filter(([name]) => name.startsWith("@antelopejs/interface-"));
      await ctx.verify("the ranges", [
        check("the table lists at least the six required interfaces", interfaces.length >= 7, interfaces.map(([name]) => name)),
        ...interfaces.map(([name, spec]) => check(`${name} is in the table with the same range`, table.get(name) === spec, [table.get(name), spec])),
        check("the dashboard layer pins one renderer minor", /^>=\d+\.\d+\.\d+ <\d+\.\d+\.0$/.test(String(pick(frontend, "engines", "@antelopejs/dms-frontend"))), pick(frontend, "engines")),
      ]);
    },
  },
]);
