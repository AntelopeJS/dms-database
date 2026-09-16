import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default antelopeKnipConfig({
  // The harness is loaded by `ajs module test`, not imported, and it is what
  // pulls in the in-memory Mongo.
  entry: ["src/test/harness.ts"],
});
