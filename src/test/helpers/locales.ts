import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord, isString } from "../../utils/guards";

const LOCALES_DIR = join(__dirname, "../../../frontend-vue/i18n/locales");

/** The locale files of the dashboard layer. */
export function localeFiles(): string[] {
  return readdirSync(LOCALES_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort();
}

/**
 * The sentence a locale file holds under a dotted key.
 *
 * @param file The locale file
 * @param key The dotted key, without the `$` of a backend message
 * @returns The sentence, or nothing when the key does not name one
 */
export function localeMessage(file: string, key: string): string | undefined {
  let node: unknown = JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf8"));
  for (const part of key.split(".")) {
    if (!isRecord(node) || !Object.hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return isString(node) && node !== "" ? node : undefined;
}
