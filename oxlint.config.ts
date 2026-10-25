import { defineConfig } from "oxlint";
import {
  ANTELOPE_IGNORE_PATTERNS,
  antelopePreset,
} from "@antelopejs/tooling-configs/oxc/lint";

/** ESLint owns `frontend-vue` until the Vue layer moves to oxlint. */
export default defineConfig({
  extends: [antelopePreset({ importSorting: false })],
  ignorePatterns: [...ANTELOPE_IGNORE_PATTERNS, "frontend-vue/**"],
  options: { typeAware: true },
});
