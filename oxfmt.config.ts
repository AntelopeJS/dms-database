import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/** Prettier owns `frontend-vue` and the Vue files; Markdown, the journeys, their helpers and the e2e playground are not formatted. */
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
