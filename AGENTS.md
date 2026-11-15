# dms-database

`@antelopejs/dms-database`, the database console of the AntelopeJS DMS: a backend module with its Vue frontend.

## Layout

- `src`: the backend module. `src/pages` declares the pages as DMS blocks; `src/routes` serves the module's API.
- `frontend-vue`: the Vue layer, registered through `dms.frontend.ts` under the `DmsDatabase` prefix. ESLint and Prettier own it, not oxlint and oxfmt. `app/build` is private to the layer and imported by path. `build/backend-boundary.ts` is a Vite plugin, registered by `dms.frontend.build.ts` and by the vitest config, that fails a build, the dev server or a test when the frontend resolves a module under the backend `src`.
- `playground`: a project with a `demo` and a `shop` schema. It has its own lockfile and is not a workspace package.
- `skills` ships in the package, declared under `antelopeJs.skills`. `docs` is not packed; it is the source of the module's pages on the documentation site.

`frontend-vue` is a pnpm workspace package with its own lockfile (`shared-workspace-lockfile=false`), so one root install covers both.

## Versioning

- `@antelopejs/dms-frontend` is capped below the next minor (`<0.12.0`), in `package.json`, `frontend-vue/package.json` (`engines`), `playground/package.json` and the README compatibility table. Move the four together.
- Every `@antelopejs/*` range stops below the next minor (`>=x.y.z <x.(y+1).0`, `~` for a 1.x package), because AntelopeJS packages ship breaking changes in minor releases; the `dependency:ranges` step of `pnpm run checks` enforces it.
- The release commit writes `CHANGELOG.md`. Upgrade notes for that version follow in a separate `docs(changelog)` pull request, under `### Upgrade notes`.

## Tests

`pnpm test` builds once, then runs the backend suites in `src/test` through `ajs module test .`. The harness (`src/test/harness.ts`) boots a real DMS against an in-memory MongoDB. Set `DMS_SOURCE=/absolute/path/to/dms` to test against a local DMS runtime. `antelope-lock/` holds the lockfile of each module the harness installs, so a cached and a fresh install get the same dependencies; commit what `pnpm test` records there.

`pnpm run checks` does not run the Vue tests or the playground. CI runs the Vue ones in their own jobs:

- `pnpm test:layer`: vitest over `frontend-vue/tests`, in the `formal-table-watch` job.
- `pnpm test:frontend`: builds and type-checks the module inside a generated Inertia app, in the `frontend` job.
- `scripts/check-sources.mts` runs in `pnpm lint`: the components the backend pages name exist, `<i18n-t>` reads the global messages, and every text key a page names resolves in each locale.
- The playground is linted but not type-checked. Check it with `pnpm --dir playground install --ignore-workspace --frozen-lockfile && pnpm --dir playground build`.

`e2e/` is the Playwright suite of the verify skill's journeys, one spec per feature, run on the `e2e/playground` project with one worker that starts its own MongoDB, backend and dashboard on free ports. `pnpm e2e:smoke` builds once and runs the journeys tagged `@smoke`, as the `e2e` job of `ci.yml` does on every pull request; `e2e-nightly.yml` runs every journey in shards. After `pnpm e2e:build`, `pnpm e2e:run specs/<feature>.spec.ts` runs one feature without a rebuild.

`pnpm knip` checks dependencies only. `pnpm knip:all` also reports unused files and exports; confirm each finding before you remove it.

## Orb

`.agents/setup` belongs to the guardrail pack. The playground's MongoDB install and build live in `.agents/playground`, which the `dms-backend` service runs before it starts.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

CI runs `pnpm run checks` in full on every pull request and reports what failed. The commit hook formats and lints the staged files. Locally, run only the fast check for what you touched:

- `pnpm run typecheck` after you change types or signatures.
- `pnpm exec oxlint <files>` and `pnpm exec oxfmt <files>` on the files you changed.
- One test file, not the suite. In a module that tests with `ajs module test`: `pnpm run build`, then `pnpm exec ajs module test . -f dist/<path>.test.js`.

Prove a change works with the verification skill in [`.agents/skills/verify-dms-database/SKILL.md`](.agents/skills/verify-dms-database/SKILL.md) before you call it done.

### Comments

Say it in code: a constraint in a type, a lint rule or a test, a public item's contract in TSDoc. Other comments are lint directives naming their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, and license or tool directives. A reason states what the code does now.

### Tests

Each test names the wrong implementation it fails on, or is deleted. Drive behaviour through the public interface. An invariant over many files is a lint rule.

### Review

No tool checks these:

- A type guard checks the nested elements and values it claims.
- A no-upward import rule rejects same-tier peers; probe it with an import.
- A finding only an evasion or a patched internal can trigger goes under Attention and never blocks.

### Suppressions

`guardrails.suppressions.json` caps lint directives, `@ts-expect-error`, `SAFETY:` comments and rules a lint config turns off. Over a cap, fix the code or remove another suppression of that kind; only the operator raises a number. After removing suppressions, run `pnpm run suppressions:update` and commit the file.

<!-- antelopejs-guardrails:end -->
