---
name: verify-dms-database
description: "Drive the AntelopeJS dms-database module (the Database console: Overview, Schemas, Diagram, Data browser, Query console, saved and shared queries) the way the platform owner does, inside a DMS with free ports, its own MongoDB database and a playground of schemas, and report a verdict with evidence. Use to prove a change to AntelopeJS/dms-database works before merge, or to verify a PR."
---

# Verify dms-database

The scripted journeys are a Playwright suite in the repository's `e2e/` folder: `e2e/journeys/<feature>.mjs` holds a feature's journeys, `e2e/specs/<feature>.spec.ts` registers them, and CI runs the ones tagged `@smoke` on the full tier and every journey on the nightly tier. You choose which features to run, judge what they show, and look at the product yourself with `dms-control`; you never write a multi-step shell recipe. When a journey you need does not exist, add it to `e2e/journeys/<feature>.mjs`, describe it in its feature file, and run its spec.

`dms-control` is the bin of `@antelopejs/dms`, a devDependency of this repository. Run it with Node 24 after `pnpm install`:

```bash
C="pnpm exec dms-control"
$C                       # lists every command
```

Give `doors` and `--skill` absolute paths when you run them from another folder.

## Launch

```bash
RUN=$($C up --prepare --base origin/main)   # installs, builds, starts; prints the run folder
```

`--prepare` runs the `prepare` commands of `verify.config.ts`: the frozen install, the build of the module, the link of the verification playground's `node_modules` to the repository's, and the TypeScript build of the playground's fixture module. Without it `up` uses the builds already there, and `doctor` fails on a stale one. `up` reads the playground from `verify.config.ts` (`e2e/playground/`, which the Playwright suite starts too) and starts an isolated DMS:

- the checkout is laid out again under `$RUN/root`, every sibling linked, and the playground copied without `node_modules`, so the run's build and `.antelope/` are its own;
- the API and the dashboard get free ports from the kernel, and `HOME` is `$RUN/home`;
- a `mongod` the run owns serves `verify_<run>` databases, as the only member of a replica set, so change streams work;
- the backend runs `ajs project start -e docs`, the dashboard `ajs dms start -e docs -b <api>`.

The playground (`e2e/playground/src`) registers the schemas the journeys read: `demo` (posts, comments, tags), `shop` (customers, products, orders, order_items, with the `eu` and `us` instances), `vault` (accounts with hashed, encrypted and localized columns, a 17-column table, related tables), `metrics` (`readings` with 1,250 rows and an empty `empty_log`) and eight schemas named for the built-in labels (`app-site`, `core`, `global`, `staging-eu`, `reviews`, `production`, `billing`, `tenant-acme`). Its fixture controller makes a member with a role of given permissions (`POST /verify-database/member`).

## Doctor

```bash
$C doctor "$RUN"          # prints only failing checks; --verbose prints all
```

Do not drive a run that fails doctor.

## Drive

```bash
$C plan --base origin/main                 # the diff mapped to features; unmapped surfaces
pnpm e2e:build                             # once: the module, the playground and the dashboard
pnpm e2e:run specs/smoke.spec.ts specs/<feature>.spec.ts
pnpm e2e:run -g <journey-id>               # one journey
pnpm exec playwright show-trace e2e/test-results/<test>/trace.zip
```

- Run the spec of every feature `plan` lists as `run`, plus `smoke`, with at most two spec files per command. The suite needs no `up`: each Playwright worker starts its own MongoDB replica set, backend and dashboard on free ports and stops them when the run ends. A feature takes up to several minutes (diagram, schemas, data and editing are the longest), so start it in the background and wait for its output.
- A failed journey keeps its trace and the backend log of its last start under `e2e/test-results/<test>/`; read them before you judge the failure. A journey whose backend or dashboard ended by itself says so in its failure.
- Each feature file in [features/](features/README.md) lists its source globs (`covers:`), its docs pages (`docs:`), its journeys and a coverage table; the journeys are in `e2e/journeys/<feature>.mjs` and `e2e/journeys/parts/`, with the helpers they share in `e2e/database.mjs` (requests, checks, members, configuration switches).
- A journey starts on an empty database with the administrator onboarded and the backend restarted on it, so configuration switches are gone and the playground has seeded its schemas again. It reads every mutation back through a second view: the API, a reload, another tab, another account, or a backend restart.
- `withConfig(ctx, { VERIFY_DATABASE_*: … }, body)` restarts the backend with module options set (`DRIVER_LABEL`, `SCHEMA_LABELS`; see `e2e/playground/antelope.config.ts`) and restarts it again without them.
- To look at the product yourself, drive the run `up` started: `$C onboard "$RUN"`, `$C browser "$RUN" login`, `goto --path`, `snapshot`, `click --role --name`, `fill`, `press`, `screenshot`, `$C api "$RUN" <method> <path> [--as anon] [--body <json>]`, `$C reset "$RUN"`. Each writes its evidence under `$RUN/evidence/`.
- `dms-control map`, `journey` and `verdict` read the journeys from this folder, which no longer holds them, so they do not work for this skill; `plan` and `doors` do.

## Evidence

The suite reports each journey as a Playwright test named by its id, its steps named like `admin click button "Login"` and each check as a soft expectation `name: what was seen`. A failed test keeps its trace (`trace.zip`), its error context and the backend log under `e2e/test-results/`. The control commands write theirs under `$RUN/evidence/`: `action.json`, `url.txt`, `aria.yml` and `screenshot.png` for a browser step, `request.json` and `response.json` for a request. Read the evidence before you judge a PASS: a check passing proves only what it asserts.

## Cleanup

```bash
$C down "$RUN"
```

## Verdict rules

1. **Run every feature whose `covers:` globs the diff touches, plus the smoke journey.** `plan` prints that list as `run`.
2. **Unmapped surface fails the verdict.** User-facing code is `src/**`, `frontend-vue/**`, `skills/**` and `package.json`, tests and tool configs excluded (`verify.config.ts`). `plan` lists the unmapped surfaces of the diff.
3. **Every registered journey of a feature in `run` must have run and passed.** Read it from the Playwright report of the spec runs: no test failed, was flaky or did not run. A known finding is a check its journey's `knownFailures` names, with the finding the feature file's Gotchas describe: the check is annotated `known failure` while the product still fails it, and fails the test once it passes. Every other check of that journey still counts.
4. **Docs.** Judge every `docs:` page of each touched feature against what the journeys showed.
5. **Formal checks.** [`formal-table-watch`](../formal-table-watch/SKILL.md) covers the table-watch trigger (`src/automation/tableWatch.ts`): `$C formal "$RUN"` runs it when the diff touches its files. Its two recorded findings fail a verdict only when the diff changes the covered behaviour. [`formal-access-write-back`](../formal-access-write-back/SKILL.md) covers the access write-back (`src/service/connectionState.ts`, `src/config.ts`) over any shape of `externalConnections`; it has no recorded finding, so any failure fails the verdict.
6. **One-way doors.** The section comes right after the result line and is mandatory. `$C doors` prints the `One-way-door:` line for the diff.
7. **Result.** FAIL if any of rules 1 to 6 fail. PASS+NOTES when something is not verified or needs the owner's attention. PASS otherwise.

Report the verdict in your own reply: the result line, the one-way doors, the specs you ran with their passed, failed and expected-failure counts, the docs judged, what is not verified and what needs attention.

## Gotchas

- Every dashboard page renders on the server and hydrates after `load`; a click that lands first does nothing. Every `tab` action waits for the page to hydrate before and after it, the journeys click again until what the click opens shows, and `tab.signIn` waits for the sign-in form to hydrate.
- The suite's browser is 1280 px wide. Journeys that need another width set the viewport.
- A journey whose backend or dashboard stopped answering fails, and the failure says which process ended.
- Pages and routes are owner-only: members hold no module permission, so a member is only used to prove a refusal.

## Not driven

List these as not verified in every verdict:

- the Overview's unreachable-database state (Unavailable, Last error, Check again): a journey cannot stop and restart the suite's MongoDB (draft `dms-control-stop-database`);
- the Table watch trigger's failure on a standalone MongoDB and its one reconnect: the suite's MongoDB is a replica set, and a journey cannot break its change stream;
- the Overview's empty schema-cards state: the DMS registers its own schemas, so the list is never empty;
- history rows written before runs recorded a status, and the Yesterday group of the history: a journey cannot write a legacy row or age a run;
- the Diagram's name order of the tables without relations: `frontend-vue/tests/diagramLayout.test.ts` checks it, no journey does (see the diagram feature);
- the column completion of the console, Format, the Chart view and "Open in data browser" of a result row, until a journey drives them (listed in the query feature's coverage table);
- the supported extension boundary (root barrel exports, no subclassing contract): a statement of non-support has no observable effect;
- the role editor hiding one block per role: pages stay owner-only, so a hidden block has no effect an owner can see.

## Feature map

[features/README.md](features/README.md).
