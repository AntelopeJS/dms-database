import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/** Prettier owns `frontend-vue` and the Vue files; Markdown is not formatted. */
export default antelopeFmtPreset({
  ignorePatterns: ["frontend-vue/**", "**/*.md", "**/*.vue"],
});
