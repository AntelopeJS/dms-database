import { check, db, isRow, list, pick, text } from "../../database.mjs";

/**
 * @typedef {import("../../database.mjs").Ctx} Ctx
 * @typedef {import("../../database.mjs").Tab} Tab
 * @typedef {{ name: string, type: string, icons: string[], title: string }} Row
 * @typedef {{ id: string, name: string, kind: string, x: number, y: number, width: number, height: number, lines: string[], selected: boolean, rows: Row[], toggle: string, expanded: string }} Node
 * @typedef {{ x: number, y: number }} Point
 */

const PAGE = "/modules/database/diagram";
const WAIT_MS = 25_000;
const POLL_MS = 250;
export const VIEWPORT = { width: 1440, height: 900 };

/**
 * Opens the diagram signed in, with a fixed viewport, and waits until it draws its tables or says it is empty.
 *
 * @param {Ctx} ctx The journey
 * @param {string} [query] The query string, with its question mark
 * @param {Tab} [existing] A tab that is already signed in
 * @returns {Promise<Tab>} The tab
 */
export async function openDiagram(ctx, query = "", existing) {
  const tab = existing ?? (await ctx.tab());
  if (!existing) await tab.signIn("admin");
  await tab.page.setViewportSize(VIEWPORT);
  await tab.goto(`${PAGE}${query}`);
  await ready(tab);
  return tab;
}

/**
 * Waits for the canvas: a table node, or the empty state.
 *
 * @param {Tab} tab The tab on the diagram
 * @returns {Promise<void>}
 */
export async function ready(tab) {
  await tab.page.locator(".vue-flow__node-tableNode, [data-empty-schema], .vue-flow").first().waitFor({ state: "visible", timeout: WAIT_MS });
  await tab.page.waitForFunction(() => document.querySelectorAll(".vue-flow__node").length > 0 || document.body.innerText.includes("No tables in"), { timeout: WAIT_MS });
  await tab.page.waitForTimeout(1800);
}

/**
 * The nodes the canvas draws.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<Node[]>} The nodes, with their flow position and size
 */
export async function nodes(tab) {
  const found = await tab.page.evaluate(() =>
    [...document.querySelectorAll(".vue-flow__node")].map((element) => {
      const match = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(element instanceof HTMLElement ? element.style.transform : "");
      const kind = [...element.classList].find((name) => name.startsWith("vue-flow__node-"))?.slice("vue-flow__node-".length) ?? "";
      return {
        id: element.getAttribute("data-id") ?? "",
        kind,
        x: Number(match?.[1] ?? 0),
        y: Number(match?.[2] ?? 0),
        width: element instanceof HTMLElement ? element.offsetWidth : 0,
        height: element instanceof HTMLElement ? element.offsetHeight : 0,
        lines: element instanceof HTMLElement ? element.innerText.split("\n").map((line) => line.trim()).filter(Boolean) : [],
        selected: element.querySelector(".ring-primary\\/30") !== null,
        rows: [...element.querySelectorAll("li")]
          .filter((item) => item.querySelector("button") === null)
          .map((item) => {
            const spans = [...item.querySelectorAll(":scope > span")];
            return {
              name: spans[0]?.textContent?.trim() ?? "",
              type: spans.at(-1)?.textContent?.trim() ?? "",
              icons: [...item.querySelectorAll("svg use")].map((icon) => icon.getAttribute("href") ?? ""),
              title: [...item.querySelectorAll("[title]")].map((icon) => icon.getAttribute("title") ?? "").join(","),
            };
          }),
        toggle: element.querySelector("li button")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
        expanded: element.querySelector("li button")?.getAttribute("aria-expanded") ?? "",
      };
    }),
  );
  return found.map((entry) => ({ ...entry, name: entry.id.split("::").at(-1) ?? "" }));
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<Node[]>} The table nodes only
 */
export async function tables(tab) {
  return (await nodes(tab)).filter((node) => node.kind === "tableNode");
}

/**
 * Polls the drawn tables until `done` holds for them, and returns the last reading.
 *
 * @param {Tab} tab The tab
 * @param {(drawn: Node[]) => boolean} done Whether the canvas is the awaited one
 * @returns {Promise<Node[]>} The tables read last
 */
export async function tablesUntil(tab, done) {
  const deadline = Date.now() + WAIT_MS;
  let drawn = await tables(tab);
  while (!done(drawn) && Date.now() < deadline) {
    await tab.page.waitForTimeout(POLL_MS);
    drawn = await tables(tab);
  }
  return drawn;
}

/**
 * @param {Node[]} all Nodes
 * @param {string} name A table name
 * @returns {Node | undefined} Its node
 */
export function byName(all, name) {
  return all.find((node) => node.name === name && node.kind === "tableNode");
}

/**
 * The canvas zoom, as the view bar shows it.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<number>} The zoom in percent
 */
export async function zoomPercent(tab) {
  const label = await tab.page.getByRole("button", { name: "Reset zoom", exact: true }).innerText();
  return Number.parseInt(label, 10);
}

/**
 * Where a node is on screen.
 *
 * @param {Tab} tab The tab
 * @param {string} nodeId The node's id
 * @returns {Promise<{ x: number, y: number, width: number, height: number }>} Its box
 */
export async function box(tab, nodeId) {
  const found = await tab.page.locator(`.vue-flow__node[data-id="${nodeId}"]`).first().boundingBox();
  return found ?? { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * Presses the fold row of a table with its own click handler, so a table drawn off screen can be toggled.
 *
 * @param {Tab} tab The tab
 * @param {string} nodeId The table's node id
 * @returns {Promise<boolean>} Whether the table has a fold row
 */
export async function toggleFold(tab, nodeId) {
  return tab.page.evaluate((id) => {
    const button = document.querySelector(`.vue-flow__node[data-id="${id}"] li button`);
    if (button instanceof HTMLElement) button.click();
    return button !== null;
  }, nodeId);
}

/**
 * Drags a node by its header.
 *
 * @param {Tab} tab The tab
 * @param {string} nodeId The node's id
 * @param {Point} delta The screen distance
 * @param {Point} [grab] Where on the node to take it, from its top-left corner
 * @returns {Promise<void>}
 */
export async function drag(tab, nodeId, delta, grab = { x: 90, y: 18 }) {
  const start = await box(tab, nodeId);
  const from = { x: start.x + grab.x, y: start.y + grab.y };
  await tab.page.mouse.move(from.x, from.y);
  await tab.page.mouse.down();
  await tab.page.mouse.move(from.x + delta.x / 3, from.y + delta.y / 3, { steps: 4 });
  await tab.page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 6 });
  await tab.page.mouse.up();
  await tab.page.waitForTimeout(500);
}

/**
 * What the layout API holds for a schema.
 *
 * @param {Ctx} ctx The journey
 * @param {string} schema The schema
 * @param {string} [label] What the call does
 * @returns {Promise<Record<string, Point>>} The positions by table name
 */
export async function savedLayout(ctx, schema, label = `read the layout of ${schema}`) {
  const answer = await db(ctx, label, "GET", `/diagram/layout/${schema}`);
  const positions = pick(answer.body, "positions");
  /** @type {Record<string, Point>} */
  const out = {};
  if (isRow(positions)) {
    for (const [name, point] of Object.entries(positions)) out[name] = { x: Number(pick(point, "x")), y: Number(pick(point, "y")) };
  }
  return out;
}

/**
 * Waits until the layout API holds a position for a table that satisfies `done`.
 *
 * @param {Ctx} ctx The journey
 * @param {string} schema The schema
 * @param {(positions: Record<string, Point>) => boolean} done Whether the layout is the awaited one
 * @returns {Promise<Record<string, Point>>} The last layout read
 */
export async function layoutUntil(ctx, schema, done) {
  const deadline = Date.now() + WAIT_MS;
  let layout = await savedLayout(ctx, schema, `poll the layout of ${schema}`);
  while (!done(layout) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    layout = await savedLayout(ctx, schema, `poll the layout of ${schema}`);
  }
  return layout;
}

/**
 * Reads the notes of a schema through the API.
 *
 * @param {Ctx} ctx The journey
 * @param {string} schema The schema
 * @param {string} [label] What the call does
 * @returns {Promise<import("../../database.mjs").Row[]>} The notes
 */
export async function savedNotes(ctx, schema, label = `read the notes of ${schema}`) {
  const answer = await db(ctx, label, "GET", `/diagram/notes?schema=${encodeURIComponent(schema)}`);
  return list(answer.body, "items");
}

/**
 * @param {Point | undefined} point A position
 * @param {Point | undefined} other Another
 * @param {number} [tolerance] The distance accepted
 * @returns {boolean} Whether they are within the tolerance
 */
export function near(point, other, tolerance = 1.5) {
  return point !== undefined && other !== undefined && Math.abs(point.x - other.x) <= tolerance && Math.abs(point.y - other.y) <= tolerance;
}

/**
 * Whether the save status of the toolbar reads as given.
 *
 * @param {Tab} tab The tab
 * @param {RegExp} pattern The status text awaited
 * @returns {Promise<import("../../database.mjs").Check>} The check
 */
export async function saveStatus(tab, pattern) {
  const deadline = Date.now() + WAIT_MS;
  let seen = "";
  while (Date.now() < deadline) {
    seen = await tab.page.getByRole("status").filter({ hasText: /Layout|Saving|save/ }).first().innerText().catch(() => "");
    if (pattern.test(seen)) break;
    await tab.page.waitForTimeout(POLL_MS);
  }
  return check(`the save status reads ${pattern}`, pattern.test(seen), seen);
}

export { text };
