import { CROSS_INSTANCE, Datum, Query, Schema, SchemaInstance, Selection, SingleSelection, Stream, Table, ValueProxy } from "@antelopejs/interface-database/staged-query";
import { db, isRow, isText, list, pick } from "../../database.mjs";

/**
 * @typedef {import("../../database.mjs").Ctx} Ctx
 * @typedef {import("../../database.mjs").Answer} Answer
 * @typedef {import("../../database.mjs").Row} Row
 */

const STAGED_CLASSES = /** @type {[string, abstract new (...args: never[]) => object][]} */ ([
  ["Schema", Schema],
  ["SchemaInstance", SchemaInstance],
  ["Table", Table],
  ["Selection", Selection],
  ["SingleSelection", SingleSelection],
  ["Stream", Stream],
  ["Datum", Datum],
  ["Query", Query],
  ["ValueProxy", ValueProxy],
]);

/**
 * The query console's wire form of a staged value: a staged object travels as its class and stages, the
 * cross-instance symbol as its sentinel.
 *
 * @param {unknown} node A staged object, or any value nested in a stage
 * @returns {unknown} The JSON-able form
 */
export function encode(node) {
  if (node === CROSS_INSTANCE) return "__CROSS_INSTANCE__";
  if (Array.isArray(node)) return node.map(encode);
  if (!isRow(node)) return node;
  const staged = STAGED_CLASSES.find(([, constructor]) => node instanceof constructor);
  if (staged) {
    const stages = node.stages;
    return { __cls: staged[0], stages: Array.isArray(stages) ? stages.map(encodeStage) : [] };
  }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, encode(value)]));
}

/**
 * @param {unknown} stage One stage of a staged value
 * @returns {unknown} Its wire form
 */
function encodeStage(stage) {
  if (!isRow(stage)) return stage;
  const { stage: name, options, args } = stage;
  /** @type {Record<string, unknown>} */
  const encoded = { stage: isText(name) ? name : "", args: Array.isArray(args) ? args.map(encode) : [] };
  if (options !== undefined) encoded.options = encode(options);
  return encoded;
}

/**
 * A staged table of the playground's schemas, as the console reaches `schemas.<schema>.instance(<name>).table(<table>)`.
 *
 * @param {string} schema The schema id
 * @param {string} table The table
 * @param {string} [instance] The instance, none for the default one
 * @returns {Table} The staged table
 */
export function stagedTable(schema, table, instance) {
  const definition = { [table]: { fields: {}, indexes: {} } };
  return new Schema(schema, definition).instance(instance).table(table);
}

/**
 * Runs a staged query through the console's execute route, as the platform owner.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the query does
 * @param {unknown} query The staged query
 * @param {string} source The text shown in the console's history
 * @returns {Promise<Answer>} The answer
 */
export function runQuery(ctx, label, query, source) {
  return db(ctx, label, "POST", "/query/execute", { body: { query: encode(query), source, language: "aql" } });
}

/**
 * The stored row of a table, read through the query console's route (a second view next to browse/get).
 *
 * @param {Ctx} ctx The journey
 * @param {string} schema The schema
 * @param {string} table The table
 * @param {string} id The row id
 * @param {string} [instance] The instance
 * @returns {Promise<Row | undefined>} The row, undefined when it does not exist
 */
export async function queryRow(ctx, schema, table, id, instance) {
  const query = stagedTable(schema, table, instance).get(id);
  const answer = await runQuery(ctx, `read ${table} ${id} by query`, query, `schemas.${schema}.instance(${instance ? JSON.stringify(instance) : ""}).table("${table}").get("${id}")`);
  return list(answer.body, "rows")[0];
}

/**
 * Deletes a row through the query console's route, as a writer outside the data browser.
 *
 * @param {Ctx} ctx The journey
 * @param {string} schema The schema
 * @param {string} table The table
 * @param {string} id The row id
 * @param {string} [instance] The instance
 * @returns {Promise<Answer>} The answer
 */
export function queryDelete(ctx, schema, table, id, instance) {
  const query = stagedTable(schema, table, instance).get(id).delete();
  return runQuery(ctx, `delete ${table} ${id} by query`, query, `schemas.${schema}.instance(${instance ? JSON.stringify(instance) : ""}).table("${table}").get("${id}").delete()`);
}

/**
 * Inserts rows through the query console's route.
 *
 * @param {Ctx} ctx The journey
 * @param {string} schema The schema
 * @param {string} table The table
 * @param {Row[]} rows The rows
 * @param {string} [instance] The instance
 * @returns {Promise<Answer>} The answer
 */
export function queryInsert(ctx, schema, table, rows, instance) {
  const query = stagedTable(schema, table, instance).insert(rows);
  return runQuery(ctx, `insert into ${table} by query`, query, `schemas.${schema}.instance(${instance ? JSON.stringify(instance) : ""}).table("${table}").insert(${JSON.stringify(rows)})`);
}

export { pick };
