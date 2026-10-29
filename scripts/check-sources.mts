import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Invariants over the module's sources that no component test can reach:
 * the components the backend pages name exist, `<i18n-t>` reads the global
 * messages, and every text key a backend page names resolves in each locale.
 * Prints the violations only; exits 1 when there are any.
 */

type Messages = { [key: string]: string | Messages };

const ROOT = join(import.meta.dirname, "..", "frontend-vue");
const PAGES_DIR = join(ROOT, "..", "src", "pages");
const COMPONENTS_DIR = join(ROOT, "app", "components");
const LOCALES_DIR = join(ROOT, "i18n", "locales");

const list = (dir: string, extension: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(extension))
    .sort()
    .map((file) => join(dir, file));

const read = (file: string): string => readFileSync(file, "utf8");
const shown = (file: string): string => relative(ROOT, file);

function parseMessages(text: string): Messages {
  const messages: Messages = JSON.parse(text);
  return messages;
}

const pages = list(PAGES_DIR, ".ts").map((file) => ({
  file,
  source: read(file),
}));
const locales = list(LOCALES_DIR, ".json").map((file) => ({
  file,
  messages: parseMessages(read(file)),
}));

function isMessages(value: string | Messages): value is Messages {
  return typeof value === "object";
}

function resolves(messages: Messages, key: string): boolean {
  let node: string | Messages | undefined = messages;
  for (const part of key.split(".")) {
    if (node === undefined || !isMessages(node)) return false;
    node = node[part];
  }
  return node !== undefined && !isMessages(node);
}

const failures: string[] = [];

if (pages.length === 0) failures.push(`${shown(PAGES_DIR)}: no page found`);
if (locales.length === 0)
  failures.push(`${shown(LOCALES_DIR)}: no locale file found`);

const components = new Set(
  list(COMPONENTS_DIR, ".vue").map((file) =>
    file.slice(COMPONENTS_DIR.length + 1),
  ),
);
const named = pages.flatMap(({ file, source }) =>
  [...source.matchAll(/CustomComponent\("DmsDatabase(\w+)"\)/g)].map(
    ([, name]) => ({ file, name }),
  ),
);
if (named.length === 0) failures.push("no page names a custom component");
for (const { file, name } of named)
  if (!components.has(`${name}.vue`))
    failures.push(
      `${shown(file)}: CustomComponent("DmsDatabase${name}") has no app/components/${name}.vue`,
    );

for (const file of list(join(ROOT, "app"), ".vue"))
  for (const [tag] of read(file).matchAll(/<i18n-t\b[^>]*>/g))
    if (!/\sscope="global"/.test(tag))
      failures.push(`${shown(file)}: ${tag} does not read the global messages`);

const keys = pages.flatMap(({ file, source }) =>
  [...source.matchAll(/"\$(dms_database\.[\w.]+)"/g)].map(([, key]) => ({
    file,
    key,
  })),
);
if (keys.length === 0) failures.push("no page names a text key");
for (const { file, key } of keys)
  for (const locale of locales)
    if (!resolves(locale.messages, key))
      failures.push(
        `${shown(file)}: "$${key}" is missing from ${shown(locale.file)}`,
      );

for (const locale of locales)
  if (resolves(locale.messages, "dms_database.overview.beta.title"))
    failures.push(
      `${shown(locale.file)}: the Overview shows no beta notice, so "dms_database.overview.beta.title" has no place here`,
    );

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
