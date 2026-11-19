import { strict as assert } from "node:assert";
import { isRecord, isString } from "../utils/guards";
import {
  type Json,
  packModule,
  type PackedModule,
  repositoryJson,
  repositoryText,
} from "./helpers/repository";

const ENGLISH = "frontend-vue/i18n/locales/database-en-GB.json";
const FRENCH = "frontend-vue/i18n/locales/database-fr-FR.json";

type JsonObject = { readonly [key: string]: Json };

function isObject(value: Json | undefined): value is JsonObject {
  return isRecord(value) && !Array.isArray(value);
}

function pick(value: Json | undefined, ...path: string[]): Json | undefined {
  return path.reduce<Json | undefined>(
    (node, step) => (isObject(node) ? node[step] : undefined),
    value,
  );
}

function leafKeys(node: Json, prefix = ""): string[] {
  if (!isObject(node)) return [prefix];
  return Object.entries(node)
    .flatMap(([key, value]) =>
      leafKeys(value, prefix ? `${prefix}.${key}` : key),
    )
    .sort();
}

function emptyTexts(locale: Json, keys: readonly string[]): string[] {
  return keys.filter((key) => {
    const value = pick(locale, ...key.split("."));
    return !isString(value) || value.trim() === "";
  });
}

function packedPath(value: Json | undefined): string {
  return isString(value) ? value.replace(/^\.\//, "") : "(not a path)";
}

describe("Package", () => {
  describe("the tarball holds what its manifest names", () => {
    let packed: PackedModule;

    before(function () {
      this.timeout(120_000);
      packed = packModule();
    });

    it("packs every path the manifest points at", () => {
      const { files, manifest } = packed;
      const targets = [
        pick(manifest, "main"),
        pick(manifest, "types"),
        pick(manifest, "exports", ".", "types"),
        pick(manifest, "exports", ".", "default"),
        pick(manifest, "dmsFrontend"),
      ].map(packedPath);
      assert.deepEqual(
        targets.filter((target) => !files.includes(target)),
        [],
      );
      assert.equal(pick(manifest, "name"), "@antelopejs/dms-database");
      assert.equal(pick(manifest, "publishConfig", "access"), "public");
    });

    it("ships the skill, the layer with both locales and its pages", () => {
      const { files, manifest } = packed;
      assert.deepEqual(pick(manifest, "antelopeJs", "skills"), ["./skills"]);
      const expected = [
        "skills/dms-database/SKILL.md",
        "skills/dms-database/cases.json",
        "frontend-vue/dms.frontend.ts",
        ENGLISH,
        FRENCH,
        "frontend-vue/app/components/DataBrowser.vue",
        "frontend-vue/app/components/QueryConsole.vue",
        "frontend-vue/app/components/SchemaDiagram.vue",
        "frontend-vue/app/components/TableInspector.vue",
        "frontend-vue/app/components/ConnectionStatus.vue",
      ];
      assert.deepEqual(
        expected.filter((file) => !files.includes(file)),
        [],
      );
    });

    it("leaves out the test build, the build info and the docs", () => {
      assert.deepEqual(
        packed.files.filter(
          (file) =>
            file.startsWith("dist/test/") ||
            file.endsWith(".tsbuildinfo") ||
            file.startsWith("docs/"),
        ),
        [],
      );
    });
  });

  it("both locales hold the same texts, none empty", () => {
    const english = repositoryJson(ENGLISH);
    const french = repositoryJson(FRENCH);
    const englishKeys = leafKeys(english);
    const frenchKeys = leafKeys(french);
    assert.deepEqual(
      englishKeys.filter((key) => !frenchKeys.includes(key)),
      [],
    );
    assert.deepEqual(
      frenchKeys.filter((key) => !englishKeys.includes(key)),
      [],
    );
    assert.deepEqual(emptyTexts(english, englishKeys), []);
    assert.deepEqual(emptyTexts(french, frenchKeys), []);
  });

  it("the README compatibility table names each interface range and the layer pins one renderer minor", () => {
    const table = new Map(
      [
        ...repositoryText("README.md").matchAll(
          /^\| `(@antelopejs\/[^`]+)`\s*\| `([^`]+)`/gm,
        ),
      ].map((match) => [match[1] ?? "", match[2] ?? ""]),
    );
    const module = repositoryJson("package.json");
    const interfaces = ["dependencies", "optionalDependencies"]
      .map((field) => pick(module, field))
      .flatMap((ranges) => (isObject(ranges) ? Object.entries(ranges) : []))
      .filter(([name]) => name.startsWith("@antelopejs/interface-"));
    assert.ok(
      interfaces.length >= 7,
      interfaces.map(([name]) => name).join(", "),
    );
    for (const [name, range] of interfaces)
      assert.equal(table.get(name), range, name);
    const renderer = pick(
      repositoryJson("frontend-vue/package.json"),
      "engines",
      "@antelopejs/dms-frontend",
    );
    assert.ok(isString(renderer), "the layer's engines name the renderer");
    assert.match(renderer, /^>=\d+\.\d+\.\d+ <\d+\.\d+\.0$/);
  });
});
