---
covers:
  - src/pages/query.ts
  - src/routes/query.ts
  - src/service/queryInspection.ts
  - src/utils/requestValidation.ts
  - frontend-vue/app/components/QueryConsole.vue
  - frontend-vue/app/components/QueryBuilderPanel.vue
  - frontend-vue/app/components/QueryResultPanel.vue
  - frontend-vue/app/build/query/completion.ts
  - frontend-vue/app/build/query/csv.ts
  - frontend-vue/app/build/query/examples.ts
  - frontend-vue/app/build/query/failures.ts
  - frontend-vue/app/build/query/tableColumns.ts
  - frontend-vue/app/build/query/target.ts
  - frontend-vue/app/build/composables/useQueryRuntime.ts
docs:
  - docs/4.usage/5.query-console.md
  - README.md
---

# Query

The Query console, run and read side: write AQL, run it, read the result.

## Sub-features

- `a-query-returns-its-rows-in-the-order-it-asks`: rows, order, header, and the Run button.
- `an-instance-and-every-instance-are-targeted`: default, named and every instance.
- `a-failed-query-says-what-failed-and-offers-the-nearest-name`: syntax, unknown schema, unknown table, Replace.
- `the-insert-chips-add-their-operation`: the six chips and their text.
- `ctrl-space-completes-schemas-and-tables-from-the-workspace`: completion lists.
- `an-empty-console-offers-examples-built-on-your-own-tables`: the two examples.
- `results-over-1000-rows-are-cut-at-1000`: the 1,000 boundary, the JSON view and the CSV export.
- `the-table-view-shows-every-returned-row`: the Table view up to 1,000 rows. Fails today: product finding, draft `dms-database-query-table-view-200-rows`.
- `ctrl-space-inside-a-filter-completes-the-columns-of-the-table`: the column list inside `row.key("`.
- `the-chart-plots-the-first-numeric-column-with-pickers-for-both-axes`: the Chart view, its default axes and the X picker.
- `open-in-data-browser-opens-the-target-table-or-the-row`: the result's header link and each row's link.
- `format-tidies-a-query-onto-one-line`: Format joins a multi-line query.
- `copy-as-json-puts-the-returned-rows-on-the-clipboard`: Copy as JSON and its notice.

## How to get to it (user POV)

- Modules › Database › Query console, `/modules/database/query`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" query
```

## Gotchas

- The editor is CodeMirror: `fill` sets its text and `Control+Enter` runs it. Chips insert at the cursor, so a chip test starts from New.
- Row search of the library, writes and the confirmation are the `guard` and `library` features.

## Coverage

| Documented behaviour | Journey and check |
|---|---|
| Query starts from `schemas.<schema>.instance(<id>?)` and chains operations | `a-query-returns-its-rows-in-the-order-it-asks`, `an-instance-and-every-instance-are-targeted` |
| `Ctrl Space` completes schemas, tables (and columns) | `ctrl-space-completes-schemas-and-tables-from-the-workspace` ; columns: `ctrl-space-inside-a-filter-completes-the-columns-of-the-table` |
| Insert chips | `the-insert-chips-add-their-operation` |
| Format tidies the query | `format-tidies-a-query-onto-one-line` |
| `Ctrl Enter` runs it | `a-query-returns-its-rows-in-the-order-it-asks` (Ctrl+Enter and the Run button) |
| An empty console offers two examples | `an-empty-console-offers-examples-built-on-your-own-tables` ("Latest 10 rows" is Not driven: the first schema `demo` has no date field) |
| The result shows its row count, duration and target | `a-query-returns-its-rows-in-the-order-it-asks` |
| Table / JSON / Export CSV hold the returned rows up to 1,000 | `results-over-1000-rows-are-cut-at-1000`, `the-table-view-shows-every-returned-row` |
| Chart: the first numeric column | `the-chart-plots-the-first-numeric-column-with-pickers-for-both-axes` |
| Server returns at most 1,000 rows; truncated results say so | `results-over-1000-rows-are-cut-at-1000` |
| Open in data browser opens the target table | `open-in-data-browser-opens-the-target-table-or-the-row` |
| Copy as JSON | `copy-as-json-puts-the-returned-rows-on-the-clipboard` |
| Failures name the problem (Q29b) | `a-failed-query-says-what-failed-and-offers-the-nearest-name` |
