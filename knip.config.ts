import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default {
  // Keep this backend dependency gate scoped as before workspace installation.
  // The Vue source uses generated aliases and is checked by test:frontend.
  ignoreWorkspaces: ["frontend-vue"],
  workspaces: {
    ".": antelopeKnipConfig({
      // The harness is loaded by `ajs module test`, not imported, and it is what
      // pulls in the in-memory Mongo.
      entry: ["src/test/harness.ts"],
    }),
  },
};
