import { defineConfig } from "@playwright/test";

const MINUTE = 60_000;
const CI = Boolean(process.env.CI);

/**
 * The journeys of `specs/`, one test each. One worker owns one stack (a MongoDB replica set, the backend and the
 * dashboard on free ports), so parallelism comes from `--shard`, never from `workers`; `fullyParallel` lets a shard
 * take single journeys rather than whole features. `pnpm e2e:build` builds once; this config starts nothing itself.
 */
export default defineConfig({
  testDir: "specs",
  fullyParallel: true,
  workers: 1,
  retries: 0,
  forbidOnly: CI,
  timeout: 15 * MINUTE,
  reporter: CI
    ? [
        ["list"],
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
        ["json", { outputFile: "playwright-report/results.json" }],
      ]
    : "list",
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium" }],
});
