---
name: verify-dms-database
description: "Drive the AntelopeJS dms-database module (the Database console: Overview, Schemas, Diagram, Data browser, Query console, saved and shared queries) the way the platform owner does, inside a DMS with free ports, its own MongoDB database and a playground of schemas, and post a verdict with evidence. Use to prove a change to AntelopeJS/dms-database works before merge, to verify a PR, or to check that a seeded break or a seeded one-way door is caught."
---

# Verify dms-database

Every deterministic step is a `dms-control` command. You choose which journeys to run and judge what they show; you never write a multi-step shell recipe. When a journey you need does not exist, add it to `journeys/<feature>.mjs`, describe it in its feature file, and run it.

`dms-control` is the bin of `@antelopejs/dms`, a devDependency of this repository. Run it with Node 24 after `pnpm install`:

```bash
C="pnpm exec dms-control"
$C                       # lists every command
```

Give `seeded`, `doors` and `--skill` absolute paths when you run them from another folder.

## Launch

```bash
RUN=$($C up --prepare --base origin/campaign/integration)   # installs, builds, starts; prints the run folder
```

`--prepare` runs the `prepare` commands of `verify.config.ts`: the frozen install, the build of the module, `playwright-core` into this folder, the link of the verification playground's `node_modules` to the repository's, and the TypeScript build of the playground's fixture module. Without it `up` uses the builds already there, and `doctor` fails on a stale one. `up` reads the playground from `verify.config.ts` (`playground/` in this folder) and starts an isolated DMS:

- the checkout is laid out again under `$RUN/root`, every sibling linked, and the playground copied without `node_modules`, so the run's build and `.antelope/` are its own;
- the API and the dashboard get free ports from the kernel, and `HOME` is `$RUN/home`;
- a `mongod` the run owns serves `verify_<run>` databases (a standalone server, not a replica set);
- the backend runs `ajs project start -e docs`, the dashboard `ajs dms start -e docs -b <api>`.

The playground (`playground/src`) registers the schemas the journeys read: `demo` (posts, comments, tags), `shop` (customers, products, orders, order_items, with the `eu` and `us` instances), `vault` (accounts with hashed, encrypted and localized columns, a 17-column table, related tables), `metrics` (`readings` with 1,250 rows and an empty `empty_log`) and eight schemas named for the built-in labels (`app-site`, `core`, `global`, `staging-eu`, `reviews`, `production`, `billing`, `tenant-acme`). Its fixture controller makes a member with a role of given permissions (`POST /verify-database/member`).

## Doctor

```bash
$C doctor "$RUN"          # prints only failing checks; --verbose prints all
```

Do not drive a run that fails doctor.

## Drive

```bash
$C plan --base origin/campaign/integration   # the diff mapped to features; unmapped surfaces
$C journey "$RUN" smoke
$C journey "$RUN" <feature> [journey-id...]
```

- Run a feature whole: `journey "$RUN" <feature>` with no ids, in one call. A feature takes 3 to 25 minutes (diagram, schemas, data and editing are the longest), so start it in the background and poll its output; a run that stops at the first FAIL leaves journeys not run, and rule 3 below makes that a FAIL.
- Each feature file in [features/](features/README.md) lists its source globs (`covers:`), its docs pages (`docs:`), its journeys and a coverage table; the journeys are in `journeys/<feature>.mjs` and `journeys/parts/`, with the helpers they share in `database.mjs` (requests, checks, members, configuration switches) and `guard.mjs` (environment loss).
- A journey starts on an empty database with the administrator onboarded and the backend restarted on it, so configuration switches are gone and the playground has seeded its schemas again. It reads every mutation back through a second view: the API, a reload, another tab, another account, or a backend restart.
- `withConfig(ctx, { VERIFY_DATABASE_*: … }, body)` restarts the backend with module options set (`DRIVER_LABEL`, `SCHEMA_LABELS`; see `playground/antelope.config.ts`) and restarts it again without them.
- To look at the product yourself: `$C onboard "$RUN"`, `$C browser "$RUN" login`, `goto --path`, `snapshot`, `click --role --name`, `fill`, `press`, `screenshot`, `$C api "$RUN" <method> <path> [--as anon] [--body <json>]`, `$C reset "$RUN"`. Each writes its evidence under `$RUN/evidence/`.

## Evidence

Everything goes under `$RUN/evidence/`: `<feature>/<journey>/NN-<step>/` with `action.json`, `url.txt`, `aria.yml` and `screenshot.png` for a browser step, `request.json` and `response.json` for a request, and `checks.json` for every step that checks something; `<feature>/<journey>/result.json` and `<feature>/feature.json`. Read the evidence before you judge a PASS: a check passing proves only what it asserts.

## Cleanup

```bash
$C down "$RUN"
```

## Verdict rules

1. **Run every feature whose `covers:` globs the diff touches, plus the smoke journey.** `plan` prints that list as `run`.
2. **Unmapped surface fails the verdict.** User-facing code is `src/**`, `frontend-vue/**`, `skills/**` and `package.json`, tests and tool configs excluded (`verify.config.ts`). `map` checks the whole tree.
3. **Every registered journey of a feature in `run` must have run and passed.** Known findings stay as failing journeys (see the feature files' Gotchas): they fail a verdict only when the diff touches their feature.
4. **Docs.** Judge every `docs:` page of each touched feature against what the journeys showed.
5. **Formal checks.** None.
6. **One-way doors.** The section comes right after the result line and is mandatory. `$C doors` prints the `One-way-door:` line for the diff.
7. **Result.** FAIL if any of rules 1 to 6 fail. PASS+NOTES when something is not verified or needs the owner's attention. PASS otherwise.

Write `$RUN/evidence/judgement.json` (`doors`, `docs`, `notVerified`, `attention`, `verifier`), then `$C verdict "$RUN" --pr <n>` and, from a thread that did not write the change, `$C publish "$RUN" --pr <n>`.

## Trust

The skill is not Trusted yet. It becomes Trusted when it catches every seeded break and flags every seeded door, passes a shadow run of 10 consecutive agent PRs, and its last maintain pass is newer than the last change to the repository or its `@antelopejs` dependencies and at most 30 days old.

## Seeded breaks and doors

```bash
$C seeded smoke overview
$C doors "$PWD/.agents/skills/verify-dms-database/seeded-doors/data.patch"
```

`seeded-breaks/<feature>.patch` is one minimal product bug per feature; `seeded` builds a control and a patched worktree, runs the feature's journeys in each, and prints `CAUGHT` with the journeys that caught it, or `MISSED`. A break counts only when a journey that passes in the control fails one of its checks with the patch. `seeded-doors/<kind>.patch` holds one change per door kind.

## Gotchas

- Every dashboard page renders on the server and hydrates after `load`; a click that lands first does nothing. The journeys wait for the control they click to exist and click again until what the click opens shows, and `tab.signIn` waits for the sign-in form to hydrate.
- The run's browser is 1280 px wide. Journeys that need another width set the viewport.
- A step whose check fails because the backend or the dashboard stopped answering ends the journey with a `NOT VERIFIED` error and no failing check (`guard.mjs`), so `seeded` never counts an outage as a catch.
- Pages and routes are owner-only: members hold no module permission, so a member is only used to prove a refusal.

## Not driven

List these under `notVerified` in the judgement of every verdict:

- the Overview's unreachable-database state (Unavailable, Last error, Check again): a journey cannot stop and restart the run's `mongod` (draft `dms-control-stop-database`);
- the Table watch trigger (`database.table-watch`), its configuration, output and the replica-set failure: it needs `@antelopejs/dms-automation` and a change feed, and `dms-control` starts a standalone `mongod` (draft `dms-control-mongo-replica-set`);
- the Overview's empty schema-cards state: the DMS registers its own schemas, so the list is never empty;
- history rows written before runs recorded a status, and the Yesterday group of the history: a journey cannot write a legacy row or age a run;
- the Diagram's `dms-core__` name-prefix sorting: the interface refuses table names holding `__`, so no registered table can have a prefix (see the diagram feature);
- the column completion of the console, Format, the Chart view and "Open in data browser" of a result row, until a journey drives them (listed in the query feature's coverage table);
- the supported extension boundary (root barrel exports, no subclassing contract): a statement of non-support has no observable effect;
- the role editor hiding one block per role: pages stay owner-only, so a hidden block has no effect an owner can see.

## Feature map

[features/README.md](features/README.md).
