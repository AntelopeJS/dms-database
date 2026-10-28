import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default {
  ignoreWorkspaces: ["frontend-vue"],
  workspaces: {
    ".": antelopeKnipConfig({
      entry: ["src/test/harness.ts"],
    }),
  },
};
