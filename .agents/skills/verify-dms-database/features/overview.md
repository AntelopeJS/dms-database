---
covers:
  - src/pages/overview.ts
  - src/routes/overview.ts
  - src/routes/health.ts
  - src/service/overview.ts
  - src/service/health.ts
  - src/service/catalog.ts
  - frontend-vue/app/components/ConnectionStatus.vue
  - frontend-vue/app/build/composables/useDatabaseHealth.ts
  - frontend-vue/app/build/utils/relativeTime.ts
docs:
  - docs/4.usage/1.overview.md
  - docs/3.configuration.md
  - docs/6.faq.md
---

# Overview

The landing page of the module: whether the database answers, what it holds and what was run against it lately.

## Sub-features

- `the-connection-card-reads-the-probe`: Healthy, the probe latency, and the table, schema, row and index totals, equal to the sums of the schemas API.
- `a-configured-driver-label-shows-beside-the-age`: `driverLabel` names the database before the age of the check.
- `without-a-driver-label-the-card-shows-a-dash`: the documented dash when no label is set. Fails today: product finding, draft `dms-database-overview-driver-placeholder`.
- `the-card-age-counts-up-and-the-probe-repeats-every-thirty-seconds`: the age counts up by the second and the page probes again after 30 seconds.
- `schema-cards-list-every-schema-largest-first`: one card per schema, largest first, with instances, tables, rows and relations; a card opens Schemas filtered.
- `largest-tables-rank-the-default-instances-by-rows`: five tables, biggest first, default instances only, each linking to the Data browser.
- `recent-queries-list-your-last-five-runs`: empty state, then the last five runs, newest first, failed flagged, each linking to its run.
- `the-header-buttons-lead-to-the-working-pages`: Open query console and Browse data.

## How to get to it (user POV)

- Modules › Database, or `/modules/database/overview`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" overview
```

## Gotchas

- Queries for the feed are run through the console's execute route with the staged wire format (`tableQuery` in `database.mjs`).

## Coverage

| Documented behaviour | Journey and check |
|---|---|
| Overview: state Healthy and last check time | `the-connection-card-reads-the-probe` (Healthy), `the-card-age-counts-up-and-the-probe-repeats-every-thirty-seconds` |
| Overview: database name from `driverLabel` | `a-configured-driver-label-shows-beside-the-age` |
| Configuration: no label shows a dash; FAQ | `without-a-driver-label-the-card-shows-a-dash` (fails: finding) |
| Overview: probe latency, tables, rows, indexes | `the-connection-card-reads-the-probe` |
| Overview: one card per schema with instances, tables, rows, relations; opens Schemas filtered | `schema-cards-list-every-schema-largest-first` |
| Overview: Largest tables, default instances | `largest-tables-rank-the-default-instances-by-rows` |
| Overview: Recent queries, Query console link | `recent-queries-list-your-last-five-runs` |
| Overview: header buttons | `the-header-buttons-lead-to-the-working-pages` |
| Overview: unreachable database ("Unavailable", Check again) | Not driven: a journey cannot stop and restart the run's mongod (draft `dms-control-stop-database`) |
| Overview: empty schema cards state | Not driven: the DMS registers its own schemas, so the list is never empty |
