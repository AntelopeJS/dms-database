---
covers:
  - src/routes/query.ts
  - src/service/queryInspection.ts
  - frontend-vue/app/components/QueryConsole.vue
  - frontend-vue/app/build/components/QueryConsoleBoard.vue
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
- `confirming-a-single-row-update-needs-the-table-name-as-the-docs-say`: the docs say every write needs the name, a single-row update and a single-row replace included (dms-database#115).
- `a-confirmed-write-acts-on-the-data-of-that-moment`: the dry run is a preview, not a snapshot.
- `a-read-query-runs-straight-away`: reads open no dialog.
- `a-replace-names-its-operation-and-rows-and-waits-for-the-table-name`: a replace on one row and on every row of a table: dialog, rows, wrong name, Confirm, read back.
- `a-replace-on-a-selection-changes-every-row-the-dry-run-announced`: the replace of a three-row selection must change three rows and say `3 changed`. Fails today: product finding, draft `dms-database-guard-replace-selection-one-row`.

## How to get to it (user POV)

- Query console, any query that changes data.

## Driving it with dms-control

```bash
dms-control journey "$RUN" guard
```

## Gotchas

- The guard is client-side: `POST /query/execute` runs a write without a dry run, which is how the journeys add rows between the dry run and the confirmation.
- A replace on a missing row (`get("x").replace`) counts 0 rows and still asks for the name, like every write.
- A replace on a selection of several rows announces them all (`Replace 3 rows`) but changes one: `@antelopejs/mongodb` 1.6.2 runs it as `findOneAndReplace`, while the Database interface documents "Replace documents of this selection" and the module's dry run counts the whole selection. `a-replace-on-a-selection-changes-every-row-the-dry-run-announced` fails until the driver or the count is settled; the other replace journey asserts only what holds today (the dialog, the name, at least the picked row). Draft: `~/.cache/campaign/issues/dms-database-guard-replace-selection-one-row.md`.

## Coverage

| Documented behaviour | Journey and check |
|---|---|
| A write never runs straight away; a dry run first | the first two journeys |
| Review the operation, the target and the number of rows | `every-write-names-its-operation-and-counts-the-rows-it-would-touch` |
| To confirm, type the table name | first journey (wrong name, other case, right name); `confirming-a-single-row-update-needs-the-table-name-as-the-docs-say` |
| The dry run is a preview, not a rollback or a locked snapshot | `a-confirmed-write-acts-on-the-data-of-that-moment` |
| Confirmation executes the write against the database | first journey (read back through the API) |
| Read queries run straight away (FAQ) | `a-read-query-runs-straight-away` |
| Replace is a measured operation: the rows it would touch are the rows it changes | the dialog and the picked row: `a-replace-names-its-operation-and-rows-and-waits-for-the-table-name`; every announced row: `a-replace-on-a-selection-changes-every-row-the-dry-run-announced` (fails, see Gotchas) |
| A failed write is recorded as failed in the history | `library` feature |
| A query that replaces never runs straight away (all four write kinds: insert, update, replace, delete) | 5.query-console.md:44 | `a-replace-names-its-operation-and-rows-and-waits-for-the-table-name` |
