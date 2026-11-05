#!/usr/bin/env node
/**
 * Model-checks the `database.table-watch` automation trigger of
 * @antelopejs/dms-database (src/automation/tableWatch.ts) with TLC through
 * the shared runner of @antelopejs/tooling-configs: TableWatch.tla under the
 * CI configuration (`TableWatch.ci.cfg`), or with `--full` under the full one
 * (`TableWatch.cfg`). Exits 0 when every rule matches the record in SKILL.md,
 * 1 when a rule changed, and 2 when TLC could not run.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpec, EXIT } from "@antelopejs/tooling-configs/formal";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** Rules the trigger breaks today, with the states in TLC's shortest counterexample. */
const FINDINGS = { GiveUpCloses: 10, GiveUpOnlyOnFailedReconnect: 13 };

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--full")) {
  console.error("usage: node check.mjs [--full]");
  process.exit(EXIT.tool);
}

await checkSpec({
  dir,
  spec: "TableWatch",
  config: args.includes("--full") ? "TableWatch" : "TableWatch.ci",
  findings: FINDINGS,
});
