# dms-database

`@antelopejs/dms-database`, the database console of the AntelopeJS DMS: a backend module with its Vue frontend.

## Layout

- `src`: the backend module. `src/pages` declares the pages as DMS blocks; `src/routes` serves the module's API.
- `frontend-vue`: the Vue layer, registered through `dms.frontend.ts` under the `DmsDatabase` prefix. ESLint and Prettier own it, not oxlint and oxfmt. `app/build` is private to the layer and imported by path. `build/backend-boundary.ts` is a Vite plugin, registered by `dms.frontend.build.ts` and by the vitest config, that fails a build, the dev server or a test when the frontend resolves a module under the backend `src`.
- `playground`: a project with a `demo` and a `shop` schema. It has its own lockfile and is not a workspace package.
- `skills` ships in the package, declared under `antelopeJs.skills`. `docs` is not packed; it is the source of the module's pages on the documentation site.

`frontend-vue` is a pnpm workspace package with its own lockfile (`shared-workspace-lockfile=false`), so one root install covers both.

## Versioning

- `@antelopejs/dms-frontend` is capped below the next minor (`<0.10.0`), in `package.json`, `frontend-vue/package.json` (`engines`), `playground/package.json` and the README compatibility table. Move the four together.
- The `@antelopejs/interface-*` ranges stay `>=x.y.z <1.0.0`; `antelopejs-check-interface-ranges` in `pnpm lint` enforces the shape.
- The release commit writes `CHANGELOG.md`. Upgrade notes for that version follow in a separate `docs(changelog)` pull request, under `### Upgrade notes`.

## Tests

`pnpm test` builds once, then runs the backend suites in `src/test` through `ajs module test .`. The harness (`src/test/harness.ts`) boots a real DMS against an in-memory MongoDB. Set `DMS_SOURCE=/absolute/path/to/dms` to test against a local DMS runtime.

`pnpm run checks` does not run the Vue tests or the playground. CI runs the Vue ones in the `frontend` job:

- `pnpm test:layer`: vitest over `frontend-vue/tests`.
- `pnpm test:frontend`: builds and type-checks the module inside a generated Inertia app.
- The playground is linted but not type-checked. Check it with `pnpm --dir playground install --ignore-workspace --frozen-lockfile && pnpm --dir playground build`.

`pnpm knip` checks dependencies only. `pnpm knip:all` also reports unused files and exports; confirm each finding before you remove it.

## Orb

`.agents/setup` belongs to the guardrail pack. The playground's MongoDB install and build live in `.agents/playground`, which the `dms-backend` service runs before it starts.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, ratchet, and sync, and prints only what failed. The change is done when it prints no failure.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Debt

`guardrails.ratchet.json` records the lint findings and oversize files this repository already had. Its numbers only go down. After you remove debt, run `pnpm run ratchet:update` and commit the lowered file. A rule listed there is off for `oxlint`. The ratchet counts it instead, and the pre-commit hook rejects it on every line you add.

### What enforces what

| Rule                                                                           | Enforced by                               |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Formatting                                                                     | oxfmt                                     |
| Lint findings are errors; no rule warns                                        | oxlint preset                             |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                  |
| Every test asserts                                                             | `antelopejs/require-assertion`            |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`          |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`  |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test` |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`       |
| Files ≤ 20,000 bytes, tests included                                           | `antelopejs-check-size` (pre-commit)      |
| Existing debt only shrinks                                                     | `antelopejs-ratchet`                      |
| Types check                                                                    | `tsc` (pre-push)                          |
| No dead files, exports, or dependencies                                        | knip                                      |
| Managed files match the pack                                                   | `antelopejs-sync --check`                 |
| A test names the wrong implementation it catches                               | review; no tool                           |

<!-- antelopejs-guardrails:end -->
