import { readFileSync } from "node:fs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */

const EDITOR = { role: "textbox", name: "Query editor (AQL)" };
const QUIET_MS = 250;
const POLL_MS = 50;
const RUN_WAIT_MS = 30_000;
const LINK_WAIT_MS = 30_000;
const LINK_KEYS = ["q", "history", "source", "schema", "table", "instance"];
const REALTIME = "/api/realtime/";

/**
 * @param {number} milliseconds How long to wait
 * @returns {Promise<void>} Resolves after the delay
 */
function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Opens the Query console as the owner and waits until it is hydrated. The editor is built in the browser when the
 * console mounts, so it showing proves the console hydrated. A link into the console (`?history=`, `?q=`, `?source=`,
 * `?schema=&table=`) is opened after the mount and then dropped from the URL, so the link's keys leaving the URL
 * proves the link was opened.
 *
 * @param {Ctx} ctx The journey
 * @param {string} [path] The console path, with its query string
 * @returns {Promise<Tab>} The tab on the console
 */
export async function openConsole(ctx, path = "/modules/database/query") {
  const tab = await ctx.tab();
  await tab.signIn("admin");
  await tab.goto(path);
  await ctx.verify("the console opens", [tab.visible({ role: "heading", name: "Query console", level: 1 }, { timeoutMs: 30_000 }), tab.visible(EDITOR)], { critical: true });
  const linked = [...new URL(path, "http://console.invalid").searchParams.keys()].filter((key) => LINK_KEYS.includes(key));
  if (linked.length > 0) {
    await tab.page.waitForURL((url) => linked.every((key) => !url.searchParams.has(key)), { timeout: LINK_WAIT_MS });
  }
  return tab;
}

/**
 * Counts the page's fetch and XHR calls that have not ended, and when the last one started or ended. The realtime
 * connection stays open for the life of the page, so it is not a call to wait for.
 *
 * @param {import("playwright-core").Page} page The page
 * @returns {{ idleMs: () => number, stop: () => void }} How long no call has been in flight, and the end of the watch
 */
function watchCalls(page) {
  /** @type {Set<import("playwright-core").Request>} */
  const inFlight = new Set();
  let lastMs = Date.now();
  /** @param {import("playwright-core").Request} request The request */
  const started = (request) => {
    if (!["fetch", "xhr"].includes(request.resourceType()) || request.url().includes(REALTIME)) return;
    inFlight.add(request);
    lastMs = Date.now();
  };
  /** @param {import("playwright-core").Request} request The request */
  const ended = (request) => {
    inFlight.delete(request);
    lastMs = Date.now();
  };
  page.on("request", started);
  page.on("requestfinished", ended);
  page.on("requestfailed", ended);
  return {
    idleMs: () => (inFlight.size === 0 ? Date.now() - lastMs : 0),
    stop: () => {
      page.off("request", started);
      page.off("requestfinished", ended);
      page.off("requestfailed", ended);
    },
  };
}

/**
 * Reads the page until a run has ended: no call in flight for a quiet moment, and the page text the same on reads
 * that far apart. The run shows "Running" while it executes, the dry run of a write ends in the confirmation, a
 * read in the result or the failure, a query that fails before it is sent in the failure.
 *
 * @param {Tab} tab The tab on the console
 * @param {ReturnType<typeof watchCalls>} calls The watch started before the run
 * @returns {Promise<string>} The page text when the run ended, or when the wait ran out
 */
async function textOnceQuiet(tab, calls) {
  const deadline = Date.now() + RUN_WAIT_MS;
  const read = () => tab.page.evaluate(() => document.body.innerText);
  let seen = await read();
  let since = Date.now();
  while (Date.now() < deadline) {
    await pause(POLL_MS);
    const now = await read();
    if (now !== seen) {
      seen = now;
      since = Date.now();
    } else if (Date.now() - since >= QUIET_MS && calls.idleMs() >= QUIET_MS) {
      break;
    }
  }
  return seen;
}

/**
 * @param {Tab} tab The tab
 * @returns {import("playwright-core").Locator} The editor
 */
export function editor(tab) {
  return tab.page.getByRole("textbox", { name: "Query editor (AQL)" });
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The text of the editor
 */
export async function editorText(tab) {
  return (await editor(tab).textContent()) ?? "";
}

/**
 * Types a query into the editor and runs it with Ctrl+Enter or the Run button.
 *
 * @param {Tab} tab The tab on the console
 * @param {string} source The AQL text
 * @param {{ button?: boolean }} [options] Click Run instead of pressing the shortcut
 * @returns {Promise<string>} The page text once the run settled
 */
export async function runSource(tab, source, options = {}) {
  await editor(tab).fill(source);
  const calls = watchCalls(tab.page);
  try {
    if (options.button) await tab.page.getByRole("button", { name: /^Run/ }).click();
    else await editor(tab).press("Control+Enter");
    return flat(await textOnceQuiet(tab, calls));
  } finally {
    calls.stop();
  }
}

/**
 * @param {string} text Page text
 * @returns {string} The text on one line
 */
export function flat(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The text of the Result region, from its header to the end of the page.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The text from 'Result' on
 */
export async function resultText(tab) {
  const text = flat(await tab.page.locator("body").innerText());
  return text.slice(text.lastIndexOf(" Result ") + 1);
}

/**
 * Chooses a result view (Table, JSON, Chart).
 *
 * @param {Tab} tab The tab
 * @param {string} view The view's name
 */
export async function chooseView(tab, view) {
  await tab.page.getByRole("radio", { name: view, exact: true }).click();
  await tab.page.waitForTimeout(500);
}

/**
 * Clicks Export CSV and reads the downloaded file.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<{ name: string, text: string }>} The file name and its text
 */
export async function exportCsv(tab) {
  const download = tab.page.waitForEvent("download", { timeout: 15_000 });
  await tab.page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  const path = await file.path();
  return { name: file.suggestedFilename(), text: path ? readFileSync(path, "utf8") : "" };
}
