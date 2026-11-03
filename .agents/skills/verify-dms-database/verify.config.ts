/** A kind of one-way door. */
export type DoorKind = "data" | "format" | "contract" | "outbound" | "exposure" | "publish";

/** Path rules for one door kind: globs, declared funnel modules, and the journeys, as `feature/journey`, that contain it. */
export interface DoorRule {
  globs: string[];
  funnels: string[];
  containments: string[];
  why: string;
}

/** The repo-owned layer of the verification skill, read by `dms-control`. */
export interface VerifyConfig {
  playground: string;
  prepare: string[][];
  userFacing: string[];
  notUserFacing: string[];
  smoke: string;
  smokeJourney: string;
  doors: Record<DoorKind, DoorRule | null>;
  formal: never[];
}

const SKILL = ".agents/skills/verify-dms-database";

const config: VerifyConfig = {
  playground: `${SKILL}/playground`,
  prepare: [
    ["pnpm", "install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
    ["pnpm", "run", "build"],
    ["npm", "install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "--prefix", SKILL, "playwright-core@1.56.1"],
    ["ln", "-sfn", "../../../../node_modules", `${SKILL}/playground/node_modules`],
    ["node_modules/.bin/tsc", "-p", `${SKILL}/playground/tsconfig.build.json`],
  ],
  userFacing: ["src/**", "frontend-vue/**", "skills/**", "package.json"],
  notUserFacing: ["src/test/**", "frontend-vue/tests/**", "frontend-vue/.*", "frontend-vue/eslint.config.mjs", "frontend-vue/vitest.config.ts", "frontend-vue/pnpm-lock.yaml"],
  smoke: "smoke",
  smokeJourney: "onboard, open the Overview, find a registered schema's table in Schemas, read its rows in the Data browser, run a query on it",
  doors: {
    data: {
      globs: ["src/routes/data.ts", "src/routes/query.ts", "src/routes/diagram.ts", "src/service/rowEdit.ts", "src/service/queryInspection.ts", "frontend-vue/app/build/data/useStagedSave.ts", "frontend-vue/app/build/data/stagedWrites.ts", "frontend-vue/app/components/QueryConsole.vue"],
      funnels: [],
      containments: ["guard/a-delete-names-its-operation-target-and-rows-and-waits-for-the-table-name"],
      why: "a saved edit and a confirmed write query go straight to the database, and a deleted row, note or layout is not brought back by a revert of the code",
    },
    format: {
      globs: ["src/db/**", "src/service/stagedSerialization.ts", "frontend-vue/app/build/utils/stagedSerialization.ts"],
      funnels: [],
      containments: [],
      why: "the module's own tables (layouts, notes, history, saved queries) and the staged-query wire format are read back by the next version of the module",
    },
    contract: {
      globs: ["package.json", "src/routes/**", "src/config.ts", "src/index.ts", "frontend-vue/package.json", "frontend-vue/dms.frontend.ts", "skills/**"],
      funnels: [],
      containments: [],
      why: "the dashboard and scripts call the HTTP routes, projects set the config keys and the renderer range, and agents read the shipped skill",
    },
    outbound: null,
    exposure: {
      globs: ["src/routes/**", "src/pages/**", "src/module.ts"],
      funnels: [],
      containments: [],
      why: "every route and page is owner-only through a decorator; losing one opens the raw database to any signed-in member or visitor",
    },
    publish: {
      globs: ["package.json", ".release-it.json", "changelogen.config.json", ".github/workflows/release.yml"],
      funnels: [],
      containments: [],
      why: "the package name, its files and the release workflow claim @antelopejs/dms-database in the npm registry",
    },
  },
  formal: [],
};

export default config;
