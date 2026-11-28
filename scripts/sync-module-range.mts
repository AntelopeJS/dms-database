import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SOURCE =
  /(package:\s*"@antelopejs\/dms-database",\s*version:\s*")[^"]*"/g;

const version = process.argv[2] ?? "";
const parts = /^(?<major>\d+)\.(?<minor>\d+)\.\d+$/.exec(version)?.groups;
if (parts === undefined) {
  throw new Error(`Expected a version such as 0.6.0, got "${version}"`);
}
const major = Number(parts.major);
const minor = Number(parts.minor);
const range = `>=${major}.${minor}.0 <${major}.${minor + 1}.0`;

const files = [
  "README.md",
  ...readdirSync(join(ROOT, "docs"), { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".md"))
    .map((file) => join("docs", file)),
];
for (const file of files) {
  const path = join(ROOT, file);
  const text = readFileSync(path, "utf8");
  const next = text.replace(SOURCE, `$1${range}"`);
  if (next !== text) {
    writeFileSync(path, next);
  }
}
