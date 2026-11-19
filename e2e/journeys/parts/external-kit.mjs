import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, db, isRow, pick, show, withConfig } from "../../database.mjs";
import { browse, settle } from "./browse.mjs";

/**
 * @typedef {import("../../database.mjs").Ctx} Ctx
 * @typedef {import("../../database.mjs").Tab} Tab
 */

export const ERP = "erp";
const LOCKED = "Not available on an external database";

/**
 * A project the DMS configuration writer can rewrite: the playground's own file holds its modules in a spread, which
 * the writer refuses, so the backend points the writer at this folder through `VERIFY_DATABASE_PROJECT_ROOT`.
 *
 * @param {string} entry The module entry's text
 * @returns {string} The configuration file
 */
function projectConfig(entry) {
  return `import { defineConfig } from "@antelopejs/interface-core/config";\n\nexport default defineConfig({\n  name: "scratch",\n  modules: {\n    "dms-database": ${entry},\n  },\n});\n`;
}

/** The writable project: `erp` listed with the read access the playground gives it. */
export const WRITABLE = projectConfig(`{\n      source: { type: "local", path: "." },\n      config: { externalConnections: { erp: { access: "read" } } },\n    }`);

/** A project whose modules sit in a spread, which the writer cannot rewrite without losing a part. */
export const UNWRITABLE = `import { defineConfig } from "@antelopejs/interface-core/config";\n\nconst modules = { "dms-database": { source: { type: "local", path: "." } } };\n\nexport default defineConfig({\n  name: "scratch",\n  modules: { ...modules },\n});\n`;

/**
 * Makes the `erp` database, restarts the backend with it wired on the project folder holding `file`, runs `body`
 * and restarts the backend as it was.
 *
 * @param {Ctx} ctx The journey
 * @param {string} file The project's configuration file
 * @param {(root: string) => Promise<void>} body What to do on the external database
 * @returns {Promise<void>}
 */
export async function withExternal(ctx, file, body) {
  const root = await mkdtemp(join(tmpdir(), "e2e-erp-"));
  try {
    await writeFile(join(root, "antelope.config.ts"), file);
    const seeded = await ctx.api("make the erp database", { method: "POST", path: "/verify-database-erp/seed", as: "anon" });
    await ctx.verify("the erp database holds its rows", [check("the seed answers its three customers", pick(seeded.body, "customers") === 3, show(seeded.body))], { critical: true });
    await withConfig(ctx, { VERIFY_DATABASE_EXTERNAL: "1", VERIFY_DATABASE_PROJECT_ROOT: root }, () => body(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The page's visible text on one line
 */
export async function pageText(tab) {
  return (await tab.page.locator("body").innerText()).replace(/\s+/g, " ").trim();
}

/**
 * Opens the switcher and picks a database, which reloads the page on it.
 *
 * @param {Tab} tab The tab
 * @param {string} from The name the switcher shows
 * @param {string} to The name of the database to pick
 * @returns {Promise<string>} The menu's text before the pick
 */
export async function pickDatabase(tab, from, to) {
  const row = { role: "button", name: new RegExp(to), within: { role: "list", name: "Databases" } };
  await tab.click({ role: "button", name: `Database: ${from}` });
  await tab.visible(row);
  const menu = await pageText(tab);
  await tab.click(row);
  await tab.visible({ role: "button", name: `Database: ${to}` }, { timeoutMs: 60_000 });
  return menu;
}

/**
 * @param {Tab} tab The tab
 * @param {string} name A sidebar entry
 * @returns {Promise<boolean | null>} Whether the entry is disabled, null when it is not there
 */
export async function lockedEntry(tab, name) {
  return tab.page
    .getByRole("button", { name: `${name} · ${LOCKED}` })
    .first()
    .isDisabled({ timeout: 5_000 })
    .catch(() => null);
}

/**
 * @param {Tab} tab The tab
 * @param {string} name A link's name
 * @returns {Promise<boolean>} Whether the link is there and disabled
 */
export async function disabledLink(tab, name) {
  const link = tab.page.getByRole("link", { name, exact: true }).first();
  return (await link.evaluate((element) => element.getAttribute("aria-disabled") === "true" || element.hasAttribute("disabled"), undefined, { timeout: 5_000 }).catch(() => false));
}

/**
 * @param {Tab} tab The tab
 * @param {string} name A link's name
 * @returns {Promise<boolean>} Whether the link is there and not disabled
 */
export async function enabledLink(tab, name) {
  const link = tab.page.getByRole("link", { name, exact: true }).first();
  return link.evaluate((element) => element.getAttribute("aria-disabled") !== "true" && !element.hasAttribute("disabled"), undefined, { timeout: 5_000 }).catch(() => false);
}

/**
 * Closes every open tab of the Data browser, which leaves the list of the tables opened lately.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<void>}
 */
export async function closeTabs(tab) {
  for (let open = await tab.page.getByRole("button", { name: "Close tab" }).count(); open > 0; open -= 1) {
    await tab.page.getByRole("button", { name: "Close tab" }).first().click();
    await settle(() => tab.page.getByRole("button", { name: "Close tab" }).count(), (count) => count === open - 1);
  }
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} What the access bar says, empty when there is none
 */
export async function accessBar(tab) {
  return (await tab.page.locator("[data-access-state]").first().innerText({ timeout: 5_000 }).catch(() => "")).trim();
}

/**
 * @param {Tab} tab The tab
 * @param {string} state What the bar must read
 * @returns {Promise<string>} What the bar reads once it does, or last
 */
export function barReads(tab, state) {
  return settle(() => accessBar(tab), (found) => found === state);
}

/**
 * The names of the tables of the Data browser's sidebar, and the entries the Recently opened list offers.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} The entries' schema.table, newest first
 */
export async function recentEntries(tab) {
  const labels = await tab.page.locator("section button.font-mono").allInnerTexts();
  return labels.map((label) => label.replace(/\s+/g, " ").trim().replace(/ (this minute|just now|now|\d+ \S+ ago)$/, ""));
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<unknown>} The stored customer c1
 */
export async function storedCustomer(ctx) {
  const answer = await browse(ctx, "read c1", "get", `${ERP}.customers`, { id: "c1" });
  return isRow(answer.body) ? answer.body : undefined;
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} access The access to write
 * @returns {Promise<import("../../database.mjs").Answer>} The answer
 */
export function setAccess(ctx, access) {
  return db(ctx, `access of erp: ${access}`, "PUT", `/connections/${ERP}/access`, { body: { access } });
}

