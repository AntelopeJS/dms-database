---
name: formal-access-write-back
description: Property check (fast-check) of the access write-back of @antelopejs/dms-database, writeAccess in src/service/connectionState.ts and withAccess in src/config.ts, over any shape of config.externalConnections. Use when a change touches those two functions, the ExternalConnectionConfig type, or the configuration writer stub in test-fixtures/dms-builder-stub.
---

# Property check: the access write-back

The Data browser's access switch changes one external connection's access by writing every connection's settings back through the DMS configuration writer (`ConfigureModule`). A project file can hold anything under `externalConnections`: a `null` entry, an empty one, an `access` that is not `read` or `read-write`, or a value that is not an object. If the write-back reads one of those wrongly, every access change of the project answers 500 or 503 and the owner cannot switch any connection. `#186` fixed one such case (`{ crm: null }` threw a `TypeError` on every change); `#184` pinned two more with hand-picked values.

## The property

For any `externalConnections` record and any target and access the account allows, `writeAccess(target, access)` never throws, and the payload sent to `ConfigureModule` is the input with only the target's `access` replaced:

- the target is written as `{ access }`, present or not in the input;
- every other entry is written as `{ access: <the value it held> }` when it held an `access`, whatever that value is, and as `{}` otherwise (`null`, `undefined`, `{}`, an object without `access`, a string, a number, a boolean or an array);
- no entry is added, dropped or reordered in meaning.

`src/test/access-write-back.property.test.ts` holds it. It runs 150 generated records per run: keys from a pool that includes `erp`, `archive`, `__proto__`, `constructor`, `toString`, the empty string and arbitrary strings, up to 6 entries, each entry one of the shapes above with arbitrary JSON as its `access` and as extra keys. Targets are `erp` (`read` and `read-write`, the account can write) and `archive` (`read`, the account only reads). The oracle is the table above, built from what the generator put in, never from the code.

## Run it

From the repository root, with Node 24 and `pnpm install` done:

```sh
pnpm run formal:access-write-back
```

It builds, then runs the one test file through `ajs module test`. The same file runs in `pnpm test`, so `pnpm run checks` and the `ci` job run it. `FC_SEED=<number>` explores another sample; the default seed is `20261116`. Keep the failing seed and the printed counterexample when reporting a failure: the same seed reproduces the generation and the shrinking with the pinned fast-check version.

Exit 0 means the property held for every generated case. A failure prints the shrunk counterexample as `[[[id, held, kept], ...], { target, access }]`: the entries as the file held them with what the writer must send for each, and the change.

## Judge a failure

1. Rebuild the counterexample as a project configuration: `externalConnections` holds each `id` with `held`, and the owner changes `target` to `access`.
2. Check the oracle: `kept` is `{ access: held.access }` when `held` is an object with an own `access`, and `{}` otherwise. A counterexample that disagrees with that sentence is a modelling error in the test.
3. Check the writer stub: `test-fixtures/dms-builder-stub/index.js` must accept any `access` value, as the DMS's `ConfigureModule` does. A refusal there answers 503 and is a stub bug, not a product one (`#184`).
4. Otherwise it is a real defect in `writeAccessNow` or `withAccess`. Keep the property and the counterexample, report the defect, and leave the product code unchanged unless the user asks for the fix.

## Coverage record

| File | What it covers |
| --- | --- |
| `src/service/connectionState.ts` | `writeAccess`, `writeAccessNow` (the payload built from `withAccess`) |
| `src/config.ts` | `withAccess`, `ExternalConnectionConfig`, `DmsDatabaseConfig.externalConnections` |
| `test-fixtures/dms-builder-stub/index.js` | the stub the writer calls go to, and its acceptance of any `access` |
| `src/test/access-write-back.property.test.ts` | the property, the generators and the oracle |

The sync commit is `58d677c` on AntelopeJS/dms-database `next`. Compare changes to these files since it before trusting an old pass, and move it forward only after confirming that the property still describes the code.

## Bounds and what is left out

- 150 cases per run over the generators above; a pass is a sample, not a proof, and a rare shape outside them is not covered (symbol keys, getters, prototype-inherited `access`, numbers past `2^53`).
- Only the payload and the absence of a throw. The refusals before the write (`409` for an account that cannot write, `403` outside development, `400`/`404` for an unknown connection) and a builder that refuses are covered by `src/test/external-access.test.ts`.
- Two changes in flight: `external-access.test.ts` holds that case.
- What the DMS writer does with the payload.

## Confirm the check can fail

These scratch changes were run at the sync commit, each on the real code with the property test unchanged, and each failed it. With the change dropped, the check passes again.

| Scratch change | Counterexample |
| --- | --- |
| `writeAccessNow` reads `settings.access` instead of `settings?.access` (the code before `#186`) | `[[["erp", null, {}]], { target: "archive", access: "read" }]`: `TypeError: Cannot read properties of null (reading 'access')` |
| `test-fixtures/dms-builder-stub/index.js` refuses an `access` other than `read` or `read-write` (the stub before `#184`) | `[[["", { access: {} }, { access: {} }]], { target: "erp", access: "read" }]`: the writer answers `invalid_config` and the call throws |
| `writeAccessNow` writes a neighbour's access only when it is `"read-write"` and `{}` otherwise | `[[], { target: "erp", access: "read" }]`: the target is written as `{}` |
