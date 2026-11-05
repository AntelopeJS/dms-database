/** A kind of one-way door. */
export type DoorKind = "data" | "format" | "contract" | "outbound" | "exposure" | "publish";

/** Path rules for one door kind: globs and declared funnel modules. */
export interface DoorRule {
  globs: string[];
  funnels: string[];
  why: string;
}

/**
 * How the formal gate decides that a diff changed the covered behaviour:
 * `emit` compares the JavaScript statements of the covered files on the
 * base and on HEAD (types, comments, formatting, imports and export
 * keywords left out); `probe` runs a command on a checkout of each, the
 * checkout's path as last argument, and compares what it prints.
 */
export type Behaviour = { kind: "emit" } | { kind: "probe"; command: string[] };

/**
 * A formal check: the source files it covers, the check's own files, the
 * command that runs it, how its output names a violated and a passing rule,
 * how the gate decides that a diff changed the covered behaviour, and the
 * command run on the base when it did or when the check's own files changed
 * (`command` when absent).
 */
export interface FormalCheck {
  name: string;
  covers: string[];
  files: string[];
  command: string[];
  baseCommand?: string[];
  violation: RegExp | null;
  passing: RegExp | null;
  behaviour: Behaviour;
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
  formal: FormalCheck[];
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
      why: "a saved edit and a confirmed write query go straight to the database, and a deleted row, note or layout is not brought back by a revert of the code",
    },
    format: {
      globs: ["src/db/**", "src/service/stagedSerialization.ts", "frontend-vue/app/build/utils/stagedSerialization.ts"],
      funnels: [],
      why: "the module's own tables (layouts, notes, history, saved queries) and the staged-query wire format are read back by the next version of the module",
    },
    contract: {
      globs: ["package.json", "src/routes/**", "src/config.ts", "src/index.ts", "frontend-vue/package.json", "frontend-vue/dms.frontend.ts", "skills/**"],
      funnels: [],
      why: "the dashboard and scripts call the HTTP routes, projects set the config keys and the renderer range, and agents read the shipped skill",
    },
    outbound: null,
    exposure: {
      globs: ["src/routes/**", "src/pages/**", "src/module.ts"],
      funnels: [],
      why: "every route and page is owner-only through a decorator; losing one opens the raw database to any signed-in member or visitor",
    },
    publish: {
      globs: ["package.json", ".release-it.json", "changelogen.config.json", ".github/workflows/release.yml"],
      funnels: [],
      why: "the package name, its files and the release workflow claim @antelopejs/dms-database in the npm registry",
    },
  },
  formal: [
    {
      name: "formal-table-watch",
      covers: ["src/automation/tableWatch.ts"],
      files: [".agents/skills/formal-table-watch/**"],
      command: ["node", ".agents/skills/formal-table-watch/check.mjs", "--full"],
      baseCommand: ["node", ".agents/skills/formal-table-watch/check.mjs"],
      violation: /^(?:finding|BROKEN|CHANGED|HOLDS) +(\w+)/gm,
      passing: /(?<=^holds +(?:\w+, )*)(\w+)(?=,| \()/gm,
      behaviour: { kind: "emit" },
    },
  ],
};

export default config;
