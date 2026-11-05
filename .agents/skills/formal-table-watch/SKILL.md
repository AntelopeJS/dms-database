---
name: formal-table-watch
description: TLA+ model of the database.table-watch automation trigger of @antelopejs/dms-database (activate() and its 2 s probe, the pumpFeed and drainFeed loop with its one reconnect, and deactivate()), checked with TLC. Use when a change touches src/automation/tableWatch.ts or the interface-database cursor it reads, or needs proof that the trigger stops emitting and closes its change feed once deactivated.
---

# Formal check: the table-watch trigger

The `database.table-watch` trigger turns a table's change feed into automation runs. `activate()` opens a cursor on the feed and waits up to `ACTIVATION_PROBE_MS` (2 s) for an early failure. A pump then reads the cursor and calls `emit()` for each change. When a read fails, or the feed ends on its own, the pump waits `RECONNECT_DELAY_MS` (5 s), closes the cursor and opens a new one, once. `deactivate()` sets `handle.stopped` and closes the cursor. A break here makes automations stop firing without a sign, fire after `deactivate()`, fire twice, or leave a change stream open on the server. The backend tests and `verify-dms-database` never reach this code: `dms-control` runs a standalone `mongod`, which has no change feed.

Node runs other callbacks at every `await`, so the model makes each stretch of code between two awaits one step, and each answer of a cursor one step. TLC checks every order of those steps, with row changes, feed failures and `deactivate()` calls, within the bounds below.

- `TableWatch.tla` holds the variables, the actions and the rules. Each condition carries a `tableWatch.ts:NN` comment; `tableWatch.ts` is `src/automation/tableWatch.ts`.
- `TableWatch.cfg` is the full configuration and `TableWatch.ci.cfg` the CI one.
- `check.mjs` runs them through `@antelopejs/tooling-configs/formal` and compares each rule with the record below.
- `TableWatch.map.mjs`, `chart-reconnect.cfg` and `chart-deactivate.cfg` are for reading results with `/statechart`.

## Run it

From the repository root, with Node 24 and `pnpm install` done:

```sh
node .agents/skills/formal-table-watch/check.mjs          # CI configuration
node .agents/skills/formal-table-watch/check.mjs --full   # full configuration
```

Java 11 or later comes from `$JAVA`, else `java` on PATH, else the `eclipse-temurin:21-jre` Docker image (set `TLC_DOCKER_PREFIX` to name the containers). The first run downloads TLC 1.7.4 into `~/.cache/antelopejs-formal` (or `$XDG_CACHE_HOME/antelopejs-formal`) and checks its SHA-256.

| Configuration | Row changes | Feed failures | `deactivate()` calls | States | Wall time |
| --- | --- | --- | --- | --- | --- |
| CI (`TableWatch.ci.cfg`) | 2 | 2 | 2 | 1,994 | 8.0 s, 9.7 s |
| Full (`TableWatch.cfg`) | 4 | 4 | 3 | 12,054 | 8.5 s, 9.2 s |

A feed failure is a read that rejects or ends on its own, or a reopen that throws. The times are two runs each in Docker Java 21 on a shared 16-core machine with a load average near 80; most of it is container and JVM start-up for three TLC runs. The current code reconnects once per activation, so two failures reach every path it can take. The full bounds leave room for a fix that reconnects more often.

- Exit 0 means every rule that held still holds, and each finding still breaks with its recorded counterexample length.
- Exit 1 means a rule changed. `BROKEN` names a rule that held and now breaks. `CHANGED` names a finding whose shortest counterexample changed length. `HOLDS` names a finding that no longer breaks. The script keeps TLC's output in a temporary folder and prints its path.
- Exit 2 means TLC or Java could not run, or the arguments were wrong.

The lines that name a changed rule match `^(?:BROKEN|CHANGED|HOLDS) +(\w+)`. A rule that still holds prints in the lowercase `holds` line.

A finding is judged by the length of its shortest counterexample alone. A change that adds a longer counterexample to a recorded finding exits 0, so a regression of `GiveUpCloses` stays green while F1 stands. `dms-control verify formal` closes that gap for a diff: while a finding stands, it fails a verdict whose diff changes the covered behaviour. Fixing the finding closes the gap for good.

## When to run it

Run `--full` when a change touches `src/automation/tableWatch.ts` or this folder. CI runs the CI configuration on every push (job `formal-table-watch`, in the `ubuntu` gate). `dms-control verify formal` runs it when the `formal` list of `.agents/skills/verify-dms-database/verify.config.ts` names `formal-table-watch`.

## The rules

| Rule | Plain sentence | Harm when it breaks | CI, full |
| --- | --- | --- | --- |
| `NoEmitAfterDeactivate` | No change is emitted once `deactivate()` was called. | A procedure the runtime is tearing down still runs: dms-automation clears a handle's `live.armed` only after `deactivate()` resolved. | holds |
| `StopClosesFeeds` | Once `deactivate()` returned, or `activate()` threw, no cursor the trigger opened is open. | A change stream stays open on the server after the procedure is gone. | holds |
| `NoReadOnClosedFeed` | No read starts on a cursor after it was closed. | On `@antelopejs/mongodb` 1.6.2, `ReadCursor` opens a new change stream for a cursor it no longer tracks, so the trigger holds a stream nothing closes. | holds |
| `OneOpenFeed` | At most one cursor of the handle is open at a time. | Two change streams per trigger; a leaked one per reconnect. | holds |
| `EmitOnce` | No change is emitted twice. | One row change runs the procedure twice. | holds |
| `GiveUpCloses` | Once the pump gave up, no cursor it opened is open. | The failed cursor stays open until `deactivate()`. | finding F1 (10, 10) |
| `GiveUpOnlyOnFailedReconnect` | The pump gives up only when the cursor it reopened failed before it delivered a change. | Automations stop firing at the second feed error of an activation, however long the reconnected feed worked. | finding F2 (13, 13) |

`TypeOK` holds too. The numbers in brackets are the states of TLC's shortest counterexample, which `check.mjs` records. `NoEmitAfterDeactivate` checks from the call, so it also covers the weaker rule "no emit after `deactivate()` returned". The shared runner checks invariants only, so liveness is left out: that `deactivate()` returns, and that the pump keeps reading a healthy feed.

## Findings at d14f337

Each finding was replayed on `dist/automation/tableWatch.js` built by `pnpm run build` at the sync commit, against a fake change-feed table. The replays were scratch scripts and are not committed. The replay stubs `Schema.get` with a schema whose table `orders` hands out fake cursors. A fake cursor's `next()` waits until the replay answers, rejects or ends it. Its `return()` resolves a waiting read with done and waits until the replay resolves the close. `setTimeout` is a queue the replay fires by delay (2000 for the probe, 5000 for the reconnect), and `Logging.Warn` and `Logging.Error` print. The replay takes one model action per step, in TLC's order.

- **F1, the pump gives up without closing the cursor it reopened (`GiveUpCloses`).** After the reconnect, a second failure logs and returns (tableWatch.ts:211-216). It does not call `handle.iterator.return()`. The reconnect path does (line 225), and the pumpFeed TSDoc gives the reason: the failed cursor may still own a server-side change stream (lines 194-196). In TLC's counterexample, the probe passes, cursor 1 fails, the pump sleeps, closes cursor 1 and opens cursor 2, and cursor 2 fails. The replay logged `Logging.Error ... change feed failed after reconnect, giving up: change stream error` and then `open cursors [2], return() calls 1:1,2:0`. Only `deactivate()` closed cursor 2: `return() calls 1:1,2:1`. With `@antelopejs/mongodb` 1.6.2, `ReadCursor` already closes the server cursor when a read rejects, so on MongoDB the open cursor holds no server stream. A backend that keeps the stream after a failed read leaks it until `deactivate()`.
- **F2, one reconnect per activation, not per failure (`GiveUpOnlyOnFailedReconnect`).** `reconnected` is set once (line 218) and never reset. A reopened cursor that worked for weeks makes the next error final. In TLC's counterexample, cursor 1 fails, cursor 2 opens, delivers an insert, then fails, and the pump gives up. The replay logged `emit(insert {"id":1})`, then `Logging.Error ... giving up`, then `open cursors [2], reads waiting [], emits 1`. No read waits on any cursor, so later changes fire nothing until the runtime re-activates the trigger. The pumpFeed TSDoc reads "on a feed error ... it attempts ONE reconnect"; whether one per activation is intended is the owner's call.

Neither finding is filed as an issue yet.

## Read every result with /statechart

Read each TLC result with the pstack `/statechart` skill. Work on a copy of `TableWatch.tla`, the map and the chart configs in a scratch folder outside the repo, since it writes its output next to its input. Use `TableWatch.map.mjs` as the view: one region for the trigger, one for the open cursors, one for `deactivate()`. `chart-reconnect.cfg` (one change, two failures, no `deactivate()`) reaches 117 states and draws 12 states and 12 arrows: `GiveUpCloses` in 9 steps and `GiveUpOnlyOnFailedReconnect` in 12. `chart-deactivate.cfg` (one change, one failure, one `deactivate()`) reaches 187 states and draws 14 states and 18 arrows, with `deactivate()` landing in the read, the reconnect sleep and the close; every rule holds there. The view hides `Settled`, the step that changes nothing once nothing else can happen. A new bug shows as a new numbered path, and a fix shows which bug paths it removes.

## Real bug or modeling error

The runtime gets the handle only when `activate()` resolves, so no `deactivate()` lands in the probe; the model enables `Deactivate` only after `ProbePasses`. Each `deactivate()` is one step up to its `await` on `return()`. `drainFeed` takes its next read with no await after the `stopped` check (lines 176-177), and `PumpReopen` opens the next cursor and reads it in one step (lines 228, 205-207, 176-179); an order that puts a `deactivate()` inside either is a modeling error. The model lets a `deactivate()` land between a cursor's answer and the pump's resume. A read's answer reaches `drainFeed` through several promise hops, and a fake cursor that answers and a `deactivate()` called in the same task produce that order.

Replay a counterexample with the fake table above, one action per step, and assert only what the runtime sees: `emit()` calls, which cursors got `return()`, reads started on a closed cursor, and the log lines. If the replay does not reproduce a finding, treat the model as wrong until you show it is not.

## Changing the model

- For an intended code change, edit the action that maps to that code, keep the `tableWatch.ts:NN` comment on each condition and update its line, then run both configurations.
- Never weaken or drop a rule to make the check pass. A fixed finding leaves `FINDINGS` in `check.mjs` once a replay confirms the fix. A new finding goes in with its counterexample length, and into this file with its replay.
- When you change the bounds of `TableWatch.ci.cfg`, rerun the scratch changes below on it. The CI configuration must still catch each one.
- After you confirm that the model describes the code at a newer commit, move the sync commit forward. Do it only then.

## Coverage record

| Model action | Code |
| --- | --- |
| `Init` | `activate()` past validation: `openFeed`, the handle, the first read in `handle.pending` (tableWatch.ts:301-321) |
| `ProbePasses` | the probe race won by the sleep or a non-error answer, the pump's start, `return handle` (lines 322-329, 335-336, 205-207, 176-179) |
| `ProbeFails`, `ActivateThrows` | a probe error closes the cursor, then throws (lines 325, 329-333) |
| `Change`, `Deliver`, `Fail` | the cursor `openFeed` returns (lines 140-146); interface-database 0.3.0 `IterableCursor.next` |
| `Close` | interface-database 0.3.0 `IterableCursor.return`: a waiting read resolves with done |
| `PumpResume` | `drainFeed` after `await read`: done, `stopped`, `emitChange`, the next read (lines 176-186) |
| `PumpCatch` | `pumpFeed`'s catch: `stopped`, the give-up, the reconnect flag and sleep (lines 209-223) |
| `PumpWake` | the sleep's end and the close of the failed cursor (lines 223-225, 106-108) |
| `PumpReopen` | the close's end, then `openFeed` or its throw (lines 226-235) |
| `Deactivate`, `DeactivateReturns` | `deactivate()` (lines 342-346) |

The sync commit is `d14f337` on AntelopeJS/dms-database `feat/verify-dms-database-skill`. `tableWatch.ts` last changed in `78f995c`.

## Bounds and what is left out

A pass covers the bounds of the table under "Run it" only. The model leaves out:

- `cluster: "singleton"`: dms-automation activates the trigger on its elected leader only. The election is dms-automation's `formal-leader-triggers` check. Two instances that both believe they lead each hold a handle, and each emits every change.
- the dms-automation runtime around the trigger: the 10 s `TRIGGER_OP_TIMEOUT_MS` on `activate()` and `deactivate()`, the `live.armed` flag, and the reconcile that re-activates a trigger that gave up.
- `emitChange`'s `eventTypes` filter and change-type mapping: every change counts as emitted.
- changes made between a failure and the reopen. A reopened cursor starts at the current change, as a change stream without a resume token does, so those changes never fire, and no rule checks that.
- the database module behind the cursor. The model counts a cursor as open until the trigger calls `return()`, whatever the module closed on its own.
- a second `activate()` for the same procedure: each activation has its own handle.

## Confirm the check can fail

On a scratch copy of this folder (with `node_modules` reachable, for example a symlink beside it), apply one model edit at a time and run `check.mjs` with and without `--full`. Each edit mirrors the code change in the first column. These ran at the sync commit.

| Scratch change in the code, and the model edit | CI configuration | Full configuration |
| --- | --- | --- |
| `no-stop-check-after-read`: drop `if (handle.stopped) return` before `emitChange` (line 184): the `stopped` change branch of `PumpResume` emits | `BROKEN NoEmitAfterDeactivate` | same |
| `keep-pending`: drop `handle.pending = undefined` (line 178): `TakeRead` keeps `pending` | `BROKEN EmitOnce`, `CHANGED GiveUpCloses: 9 states (recorded 10)`, `HOLDS GiveUpOnlyOnFailedReconnect` | same |
| `probe-fail-no-close`: `activate()` throws without `iterator.return()` (line 330): `ProbeFails` closes nothing | `BROKEN StopClosesFeeds` | same |
| `no-close-before-reopen`: drop the close before the reopen (line 225): `PumpWake` closes nothing | `BROKEN OneOpenFeed`, `CHANGED GiveUpCloses: 7 states (recorded 10)` | same |
| `no-stop-check-after-close`: drop `if (handle.stopped) return` after the close (line 226): a stopped `PumpReopen` opens a cursor | `BROKEN StopClosesFeeds` | same |
| `await-before-read`: an `await` between the `stopped` check and `next()` (lines 176-177): a `PumpRead` step after the emit | `BROKEN NoReadOnClosedFeed`, `CHANGED GiveUpOnlyOnFailedReconnect: 14 states (recorded 13)` | same |
| `deactivate-skips-return`: `deactivate()` sets `stopped` without `iterator.return()` (line 345) | `BROKEN StopClosesFeeds` | same |
| Fix candidate `close-on-give-up`: `return()` on `handle.iterator` before the give-up returns (lines 211-216) | `HOLDS GiveUpCloses` | same |
| Fix candidate `reset-reconnected-after-change`: reset `reconnected` once a reopened cursor emits (lines 185, 218) | `HOLDS GiveUpOnlyOnFailedReconnect` | same |

Every scratch run in the table exited 1. With the edits dropped, both configurations exit 0. The `no-stop-check-after-read` path also replays on a scratch copy of `dist/automation/tableWatch.js` without line 184: the insert is emitted after `deactivate()` was called, and the real build emits nothing.
