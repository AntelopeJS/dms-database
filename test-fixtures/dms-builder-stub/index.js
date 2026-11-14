"use strict";

const { ImplementInterface } = require("@antelopejs/interface-core");

/** The calls this stub received, which the tests read under this key. */
const calls = [];
Reflect.set(
  globalThis,
  Symbol.for("dms-database-test:configure-module"),
  calls,
);

const ACCESSES = ["read", "read-write"];

/**
 * Whether a value is a non-null object.
 *
 * @param {unknown} value The value
 * @returns {value is Record<string, unknown>} Whether it is one
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * Whether a value is an object holding exactly the given keys.
 *
 * @param {unknown} value The value
 * @param {string[]} keys The keys it must hold, and only them
 * @returns {value is Record<string, unknown>} Whether it holds them
 */
function hasExactly(value, keys) {
  return (
    isRecord(value) &&
    Object.keys(value).sort().join() === [...keys].sort().join()
  );
}

/**
 * Whether an entry holds only `config.externalConnections`, each connection
 * with no setting or only an `access` of `read` or `read-write`.
 *
 * @param {unknown} entry The module entry to merge
 * @returns {boolean} Whether dms-database could have written it
 */
function isAccessEntry(entry) {
  if (!hasExactly(entry, ["config"])) return false;
  const config = entry.config;
  if (!hasExactly(config, ["externalConnections"])) return false;
  const connections = config.externalConnections;
  if (!isRecord(connections)) return false;
  return Object.values(connections).every(
    (settings) =>
      hasExactly(settings, []) ||
      (hasExactly(settings, ["access"]) && ACCESSES.includes(settings.access)),
  );
}

/**
 * Records the call, and answers the result the DMS's writer would.
 *
 * @param {string} id The module entry
 * @param {unknown} entry What to merge into it
 */
async function ConfigureModule(id, entry) {
  calls.push({ id, entry });
  if (!isAccessEntry(entry)) {
    return {
      ok: false,
      error: {
        code: "invalid_config",
        issues: [{ pointer: "", message: "unexpected entry" }],
      },
    };
  }
  return { ok: true, data: { files: ["antelope.config.ts"] }, changes: [] };
}

/** Answers the other project operations as the DMS's writer would refuse them. */
async function unsupported() {
  return { ok: false, error: { code: "unsupported", detail: "stub" } };
}

function construct() {
  ImplementInterface(require("@antelopejs/interface-dms-builder/project"), {
    ConfigureProject: unsupported,
    AddModule: unsupported,
    ConfigureModule,
    CreateLocalModule: unsupported,
  });
}

module.exports = { construct };
