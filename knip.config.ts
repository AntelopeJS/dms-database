import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default {
  ignoreWorkspaces: ["frontend-vue"],
  workspaces: {
    ".": antelopeKnipConfig({
      entry: [
        "src/test/harness.ts",
        "e2e/playwright.config.ts",
        "e2e/flaky-reporter.ts",
        "e2e/specs/*.spec.ts",
        "e2e/playground/antelope.config.ts",
        "e2e/playground/src/index.ts",
      ],
      project: ["e2e/**/*.{ts,mjs}"],
    }),
  },
};
