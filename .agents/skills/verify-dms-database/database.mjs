/**
 * @typedef {import("../../../node_modules/@antelopejs/dms/bin/control/journey.mjs").JourneyContext} Ctx
 * @typedef {import("../../../node_modules/@antelopejs/dms/bin/control/tab.mjs").Tab} Tab
 * @typedef {{ status: number | null, body: unknown, error: string | null, folder?: string }} Answer
 * @typedef {Record<string, unknown>} Row
 * @typedef {{ name: string, pass: boolean, detail: string }} Check
 */

/** The module's HTTP API, which the dashboard calls. */
export const API = "/api/database";

/** The verification playground's trusted backend calls (`playground/src/fixture.ts`). */
export const FIXTURE = "/verify-database";

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is Row} Whether it is an object
 */
export function isRow(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is string} Whether it is a string
 */
export function isText(value) {
  return typeof value === "string";
}

/**
 * Reads a nested field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {unknown} The field, or undefined when a step is missing
 */
export function pick(value, ...path) {
  let current = value;
  for (const step of path) {
    if (!isRow(current)) return undefined;
    current = current[step];
  }
  return current;
}

/**
 * @param {unknown} value The answer
 * @param {...string} path The field names
 * @returns {string} The field when it is a string, else the empty string
 */
export function text(value, ...path) {
  const found = pick(value, ...path);
  return isText(found) ? found : "";
}

/**
 * The objects of an array field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {Row[]} The array's objects, empty when the field is not an array
 */
export function list(value, ...path) {
  const found = path.length === 0 ? value : pick(value, ...path);
  return Array.isArray(found) ? found.filter(isRow) : [];
}

/**
 * A check, in the shape `ctx.record` takes.
 *
 * @param {string} name What is checked
 * @param {unknown} pass Whether it holds
 * @param {unknown} detail What was observed
 * @returns {Check} The check
 */
export function check(name, pass, detail) {
  return { name, pass: pass === true, detail: isText(detail) ? detail : (JSON.stringify(detail) ?? "undefined") };
}

/**
 * @param {unknown} value Anything
 * @returns {string} Its JSON text, for details
 */
export function show(value) {
  return JSON.stringify(value) ?? "undefined";
}

/**
 * Calls the module's API.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} method The HTTP method
 * @param {string} path The path under `/api/database`, query string included
 * @param {{ body?: unknown, as?: string }} [options] The JSON body, and the account (`admin` by default, `anon` for nobody)
 * @returns {Promise<Answer>} The answer
 */
export function db(ctx, label, method, path, options = {}) {
  return ctx.api(label, { method, path: `${API}${path}`, body: options.body, as: options.as });
}

/**
 * Calls the verification playground's trusted backend.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} method The HTTP method
 * @param {string} path The path under the fixture
 * @param {unknown} [body] The JSON body
 * @returns {Promise<Answer>} The answer
 */
export function fixture(ctx, label, method, path, body) {
  return ctx.api(label, { method, path: `${FIXTURE}${path}`, body, as: "anon" });
}

/**
 * Creates a member of the default tenant whose role holds the given permissions, and signs them up, so journeys
 * act as `name` with `ctx.api(..., { as: name })` and `ctx.tab(name)`.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The account name
 * @param {string[]} permissions The role's permission ids
 * @param {boolean} [owner] Whether the invite makes a second owner
 * @returns {Promise<{ roleId: string, userId: string }>} The role and the user
 */
export async function member(ctx, name, permissions, owner = false) {
  const invite = await fixture(ctx, `invite ${name}`, "POST", "/member", { name, permissions, owner });
  const email = text(invite.body, "email");
  const password = ctx.password();
  const signup = await ctx.api(`${name} signs up`, {
    method: "POST",
    path: "/api/auth/signup",
    body: { name, email, password, lang: "en", token: text(invite.body, "token") },
    as: "anon",
  });
  const userId = text(signup.body, "user", "_id");
  ctx.addAccount(name, { email, password, userId });
  await ctx.verify(`${name} is a member`, [check("the signup answers a session", signup.status === 200 && userId !== "", signup.status)], { critical: true });
  return { roleId: text(invite.body, "roleId"), userId };
}

/**
 * Restarts the backend with `VERIFY_DATABASE_*` variables set (see `playground/antelope.config.ts`), runs `body`,
 * then restarts it with the variables it had, so later journeys get the module's defaults back.
 *
 * @param {Ctx} ctx The journey
 * @param {Record<string, string>} env The variables
 * @param {() => Promise<void>} body What to do under that configuration
 * @returns {Promise<void>}
 */
export async function withConfig(ctx, env, body) {
  const previous = { ...ctx.state.extraEnv };
  ctx.state.extraEnv = { ...previous, ...env };
  try {
    await ctx.restartBackend();
    await body();
  } finally {
    ctx.state.extraEnv = previous;
    await ctx.restartBackend();
  }
}

/**
 * @param {string} source A JSON text
 * @returns {unknown} The parsed value, or undefined when the text is not JSON
 */
export function parseJson(source) {
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

/**
 * A staged query on one table, in the wire format the console sends.
 *
 * @param {string} schema The schema
 * @param {string} table The table
 * @param {Record<string, unknown>[]} [more] Stages after the table
 * @param {string} [instance] A named instance
 * @returns {Record<string, unknown>} The query
 */
export function tableQuery(schema, table, more = [], instance) {
  return {
    __cls: "Table",
    stages: [
      { stage: "schema", args: [], options: { id: schema } },
      instance ? { stage: "instance", args: [], options: { id: instance } } : { stage: "instance", args: [] },
      { stage: "table", args: [], options: { id: table } },
      ...more,
    ],
  };
}

/**
 * Runs a staged query as an account through the console's execute route.
 *
 * @param {Ctx} ctx The journey
 * @param {string} source The AQL text recorded in the history
 * @param {Record<string, unknown>} query The staged query
 * @param {string} [as] The account
 * @returns {Promise<Answer>} The answer
 */
export function runQuery(ctx, source, query, as) {
  return db(ctx, `run ${source}`, "POST", "/query/execute", { body: { query, source, language: "aql" }, as });
}
