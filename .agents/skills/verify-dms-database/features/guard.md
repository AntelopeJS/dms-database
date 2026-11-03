---
covers:
  - src/routes/query.ts
  - src/service/queryInspection.ts
  - frontend-vue/app/components/QueryConsole.vue
  - frontend-vue/app/components/QueryResultPanel.vue
docs:
  - docs/4.usage/5.query-console.md
  - docs/6.faq.md
  - docs/1.introduction.md
---

# Guard

A query that inserts, updates, replaces or deletes never runs straight away: a dry run measures it and the owner confirms.

## Sub-features

- `a-delete-names-its-operation-target-and-rows-and-waits-for-the-table-name`: the dialog, wrong names that do nothing, Cancel, Confirm and the result.
- `every-write-names-its-operation-and-counts-the-rows-it-would-touch`: delete, update and insert counts, the confirm label and a named-instance target.
- `a-single-row-update-can-skip-the-question-until-the-tab-closes`: the skip, its scope and that a delete still asks.
- `confirming-a-single-row-update-needs-the-table-name-as-the-docs-say`: the docs say every write needs the name. Fails today: product finding, draft `dms-database-guard-single-row-update-no-typing`.
- `a-confirmed-write-acts-on-the-data-of-that-moment`: the dry run is a preview, not a snapshot.
- `a-read-query-runs-straight-away`: reads open no dialog.

## How to get to it (user POV)

- Query console, any query that changes data.

## Driving it with dms-control

```bash
dms-control journey "$RUN" guard
```

## Gotchas

- The guard is client-side: `POST /query/execute` runs a write without a dry run, which is how the journeys add rows between the dry run and the confirmation.
- A replace on a missing row (`get("x").replace`) counts 0 rows and needs no name.

## Coverage

| Documented behaviour | Journey and check |
|---|---|
| A write never runs straight away; a dry run first | the first two journeys |
| Review the operation, the target and the number of rows | `every-write-names-its-operation-and-counts-the-rows-it-would-touch` |
| To confirm, type the table name | first journey (wrong name, other case, right name); `confirming-a-single-row-update-needs-the-table-name-as-the-docs-say` (fails) |
| The dry run is a preview, not a rollback or a locked snapshot | `a-confirmed-write-acts-on-the-data-of-that-moment` |
| Confirmation executes the write against the database | first journey (read back through the API) |
| Read queries run straight away (FAQ) | `a-read-query-runs-straight-away` |
| Single-row updates can be skipped until the tab closes; deletes and multi-row changes always ask (design Q25) | `a-single-row-update-can-skip-the-question-until-the-tab-closes` |
| Replace is a measured operation | Not driven: a replace on an existing row needs the row id typed into AQL; the dialog of a 0-row replace is shown by the probe only |
| A failed write is recorded as failed in the history | `library` feature |
