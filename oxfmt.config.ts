import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/**
 * Prettier owns `frontend-vue` and the Vue files; Markdown is not formatted. The journeys, their helpers and the
 * playground moved from the verify skill keep its one-line layout: at 80 columns a journey outgrows the lint's file
 * and function length limits.
 */
export default antelopeFmtPreset({
  ignorePatterns: [
    "frontend-vue/**",
    "**/*.md",
    "**/*.vue",
    "e2e/journeys/**",
    "e2e/database.mjs",
    "e2e/playground/**",
  ],
});
