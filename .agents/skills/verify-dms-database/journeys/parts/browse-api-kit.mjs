import { isText, pick, text } from "../../database.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */

/**
 * @param {import("../../database.mjs").Answer} answer An error answer
 * @returns {string} Its message: the body when the body is text, else the message field
 */
export function msg(answer) {
  return isText(answer.body) ? answer.body : text(answer.body, "message");
}

/**
 * @param {unknown} items A list of objects
 * @param {number} index The position
 * @param {string} field A field of the item
 * @returns {unknown} The field of the item
 */
export function itemField(items, index, field) {
  return Array.isArray(items) ? pick(items[index], field) : undefined;
}

/**
 * @param {import("../../database.mjs").Answer} answer A tables answer
 * @returns {{ name: unknown, elementCount: unknown }[]} Its items
 */
export function rowsOfItems(answer) {
  const items = pick(answer.body, "items");
  return Array.isArray(items) ? items.map((item) => ({ name: pick(item, "name"), elementCount: pick(item, "elementCount") })) : [];
}

