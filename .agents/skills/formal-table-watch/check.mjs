#!/usr/bin/env node
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
