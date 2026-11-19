---
covers:
  - src/module.ts
  - src/routes/index.ts
  - src/pages/index.ts
  - src/db/**
  - src/routes/health.ts
  - src/routes/data.ts
docs:
  - docs/1.introduction.md
  - docs/6.faq.md
  - README.md
---

# Access

The pages and the module's API answer to the platform owner only, and the module shows in the Modules catalog.

## Sub-features

- `every-route-needs-a-signed-in-session`: every read and write route answers 401 without a session. Integration test in `src/test/access.journeys.test.ts`.
- `a-member-gets-403-from-every-route-and-writes-nothing`: a member with the module's permissions gets 403 from every route and changes nothing. Integration test in `src/test/access.journeys.test.ts`.
- `a-member-sees-neither-the-pages-nor-the-catalog-tile`: no tile and no page for a member; the owner sees the tile.
- `the-catalog-tile-reads-the-database`: the tile's two readout lines, version and category.
- `the-owner-only-gate-is-logged-at-start`: the five 'gated owner-only' log lines. Integration test in `src/test/access.journeys.test.ts`.

## How to get to it (user POV)

- Modules catalog, tile Database; `/modules/database/*`.

## Driving it

```bash
pnpm e2e:run specs/access.spec.ts
```

The journeys marked integration test run in `pnpm test`; one file alone after `pnpm run build`:

```bash
pnpm exec ajs module test . -f dist/test/access.journeys.test.js
```

## Gotchas

- The member is made by the playground's fixture (`POST /verify-database/member`) with a role of the given permission ids.
- The integration tests make it with `createMemberWithRole` (`src/test/ownerSession.ts`).

## Coverage

| Documented behaviour | Journey and check |
|---|---|
| Pages reserved to the platform owner; routes answer only to the owner | the first three journeys |
| Tenants and their members never see it | `a-member-sees-neither-the-pages-nor-the-catalog-tile` |
| Adds a Database entry to the Modules catalog | `the-catalog-tile-reads-the-database` |
| FAQ: the backend logs the owner-only gate at start | `the-owner-only-gate-is-logged-at-start`: the integration test checks the gate the line reports, each page's layout route under `/modules/database/<page>` answering the owner and refusing a member with the module's permissions; the line itself is written once at start, before a test can listen |
| Own tables (`dms-database` schema) hold layouts, notes, history, saved queries | `schemas` feature lists the schema; persistence journeys of `diagram` and `library` |
| Blocks carry names so the role editor can hide one per role | Not driven: the role editor lists blocks of pages the owner alone reaches; a hidden block has no observable effect on the owner |
