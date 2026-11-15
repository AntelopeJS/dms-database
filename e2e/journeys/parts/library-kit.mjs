import { pick, db, list, tableQuery } from "../../database.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */

export const SLICE = (/** @type {number} */ end) => ({ stage: "slice", args: [0, end] });
export const TAGS_QUERY = tableQuery("demo", "tags");
export const TAGS_SOURCE = 'schemas.demo.instance().table("tags")';
export const HISTORY_LIMIT = 500;

/**
 * The runs of an account, newest first.
 *
 * @param {Ctx} ctx The journey
 * @param {string} [as] The account
 * @param {string} [query] A query string for paging
 * @returns {Promise<{ items: import("../../database.mjs").Row[], total: unknown, status: number | null }>} The page
 */
export async function history(ctx, as, query = "limit=500") {
  const answer = await db(ctx, `history of ${as ?? "admin"}`, "GET", `/query/history?${query}`, { as });
  return { items: list(answer.body, "items"), total: pick(answer.body, "total"), status: answer.status };
}

/**
 * Saves a query through the API.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The name
 * @param {boolean} shared Whether it is shared
 * @param {string} [as] The account
 * @returns {Promise<import("../../database.mjs").Answer>} The answer
 */
export function save(ctx, name, shared, as) {
  return db(ctx, `save ${name}`, "POST", "/query/saved", { body: { name, description: `about ${name}`, query: TAGS_QUERY, source: TAGS_SOURCE, language: "aql", shared }, as });
}

/**
 * The library tab of the console.
 *
 * @param {Tab} tab The tab
 * @param {string} name History, Saved or Team
 */
export async function libraryTab(tab, name) {
  await tab.page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
  await tab.page.waitForTimeout(800);
}
