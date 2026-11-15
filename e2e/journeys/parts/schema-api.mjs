import { db, list, pick, text } from "../../database.mjs";

/**
 * @typedef {import("../../database.mjs").Ctx} Ctx
 * @typedef {import("../../database.mjs").Row} Row
 * @typedef {{ scope?: string, instance?: string, q?: string, has?: string }} Filters
 */

/**
 * The query string the Schemas table view sends for a filter bar state.
 *
 * @param {Filters} filters The bar's state
 * @returns {string} The query string, with its leading question mark
 */
export function sourceQuery(filters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(`filter_${key}`, `is:${value}`);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

/**
 * Reads the tables the Schemas page lists for a filter bar state.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {Filters} [filters] The bar's state
 * @returns {Promise<{ status: number | null, rows: Row[], total: unknown, all: unknown, body: unknown }>} The listing
 */
export async function source(ctx, label, filters = {}) {
  const answer = await db(ctx, label, "GET", `/tables/source${sourceQuery(filters)}`);
  return { status: answer.status, rows: list(answer.body, "results"), total: pick(answer.body, "total"), all: pick(answer.body, "all"), body: answer.body };
}

/**
 * @param {Row[]} rows Source rows
 * @returns {string[]} Their ids, in order
 */
export function ids(rows) {
  return rows.map((row) => text(row, "id"));
}

/**
 * @param {Row[]} rows Source rows
 * @param {string} id A `schema::table` id
 * @returns {Row | undefined} The row with that id
 */
export function rowOf(rows, id) {
  return rows.find((row) => text(row, "id") === id);
}

/**
 * Reads every schema with its tables.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @returns {Promise<Row[]>} The schemas
 */
export async function schemas(ctx, label) {
  const answer = await db(ctx, label, "GET", "/schemas");
  return list(answer.body, "schemas");
}

/**
 * @param {Row[]} all The schemas
 * @param {string} schemaId A schema id
 * @param {string} table A table name
 * @returns {Row | undefined} The table's summary
 */
export function tableOf(all, schemaId, table) {
  const schema = all.find((entry) => text(entry, "id") === schemaId);
  return list(schema, "tables").find((entry) => text(entry, "name") === table);
}
