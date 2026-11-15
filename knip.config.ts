import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default {
  ignoreWorkspaces: ["frontend-vue"],
  workspaces: {
    ".": antelopeKnipConfig({
      entry: [
        "src/test/harness.ts",
        "e2e/playwright.config.ts",
        "e2e/specs/*.spec.ts",
      ],
      project: ["e2e/**/*.{ts,mjs}"],
    }),
  },
};
