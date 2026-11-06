---
covers:
  - src/pages/data.ts
  - src/routes/data.ts
  - src/service/browse.ts
  - src/service/declaredFields.ts
  - src/service/references.ts
  - src/utils/query.ts
  - src/utils/requestValidation.ts
  - frontend-vue/app/components/DataBrowser.vue
  - frontend-vue/app/components/DataBrowserSidebar.vue
  - frontend-vue/app/components/DataBrowserTabBar.vue
  - frontend-vue/app/components/DataFilterBar.vue
  - frontend-vue/app/components/DataGrid.vue
  - frontend-vue/app/components/DataGridCell.vue
  - frontend-vue/app/components/DataGridHeaderCell.vue
  - frontend-vue/app/components/RowDrawer.vue
  - frontend-vue/app/components/InstancePicker.vue
  - frontend-vue/app/components/DrawerTabs.vue
  - frontend-vue/app/build/components/DataGridEmpty.vue
  - frontend-vue/app/build/components/DataGridFooter.vue
  - frontend-vue/app/build/components/DataGridReadOnlyBanner.vue
  - frontend-vue/app/build/components/DataGridToolbar.vue
  - frontend-vue/app/build/composables/useDataBrowserGrid.ts
  - frontend-vue/app/build/composables/useDataBrowserTabs.ts
  - frontend-vue/app/build/composables/useTableCounts.ts
  - frontend-vue/app/build/composables/useElsewhereInstances.ts
  - frontend-vue/app/build/data/gridData.ts
  - frontend-vue/app/build/data/instanceOptions.ts
  - frontend-vue/app/build/data/pickerMenus.ts
  - frontend-vue/app/build/data/recentTables.ts
docs:
  - docs/4.usage/4.data-browser.md
  - docs/design/redesign-v2-grill.md
  - docs/5.extending.md
  - README.md
---

# Data

The Data browser's read side: the schema and instance pickers with the row counts of each table, tables opened as preview or kept tabs, search, column filters, sort and paging of any table, the row drawer with its fields, JSON and the rows pointing at the row, the read-only view across all instances, the empty and error states, and the browse API behind them.

## Sub-features

- `the-instance-picker-lists-named-instances-with-a-search-and-a-limit`: `tables/instances` sorted, searched without case, cut to the limit with the total, and its 400 and 404.
- `list-clamps-the-page-and-orders-the-rows`: `browse/list` answers 25 rows by default, clamps `limit` to 1..200 (199, 200, 201 driven) and `offset` to 0, sorts descending only for the word `desc`, and answers the exact total.
- `list-filters-search-and-counts-follow-the-wire-tokens`: `filter_<column>` with `is:`, `contains:`, a bare value, an unknown mode and an empty value; search across every cell; both combined; the totals.
- `the-selection-decodes-schema-table-and-instance`: `filter_schema`, `filter_table` and `filter_instance` (default, empty, named, `__CROSS_INSTANCE__`, `contains:`), the 400 and 404 refusals, and the `_instance` tag.
- `columns-get-and-tables-answer-what-the-grid-needs`: `browse/columns` (declared columns in declaration order, then sampled ones; runtime types; primary key), `browse/get` and `browse/tables` with the counts of the default instance, of eu, and across all instances.
- `references-count-the-rows-pointing-at-a-row`: `browse/references` counts per relation column, in the same instance, for one and many relations, and refuses all instances, a missing id and a missing row.
- `the-browse-api-answers-the-platform-owner-only`: anonymous 401, a member 403, on every browse route and on the edit route, nothing written.
- `the-sidebar-counts-each-table-in-the-picked-instance`: the pickers, the counts of default, eu, us and All instances, the footer naming the instance, `T` focusing the table search, `Esc`, the no-match text and the counts that cannot be read.
- `tables-open-as-preview-tabs-and-are-kept-on-demand`: italic preview tab, replaced by the next table; kept by a double-click in the list, the pin button, a double-click on the tab or a Ctrl-click; the hint line; closing; reload; the URL.
- `links-open-the-table-in-the-instance-they-name`: `?schema=&table=`, `instance=eu`, `instance=us`, `instance=all`, a schema alone, and Open in query console for each.
- `search-filters-and-sort-narrow-and-order-the-rows`: `Ctrl /`, Search rows, Add filter with contains and is exactly, chips, Clear all, the header funnel, and the three-state header sort against the API.
- `the-footer-pages-1250-rows-with-exact-ranges-at-every-size`: 25, 50, 100 and 200 rows per page of `metrics.readings`, the page buttons, the last page, Previous and Next, and totals of 99, 100 and 51 rows at the page boundaries.
- `r-refreshes-the-rows-and-the-search-shortcut-works-from-the-grid`: `R`, the Refresh button, `Ctrl /` from a focused cell, `R` typed in a field.
- `the-row-drawer-steps-through-the-page-with-j-and-k`: `Space`, "Row 3 of 50", `J`, `K`, Previous and Next, the ends, and the page's position "Row 3 of 30".
- `the-row-drawer-shows-fields-json-and-the-rows-pointing-at-it`: the tabs, the Fields tab, the JSON tab against the API, Referenced by with its counts and the link that opens the filtered table.
- `the-fields-tab-widens-long-values-and-sets-null-with-the-dashed-circle`: long text and JSON take the width, short text does not, the dashed circle stages null, the footer counts and sits at the bottom.
- `all-instances-is-a-read-only-view-with-the-instance-column`: banner, `_instance` column, no editor, read-only drawer, the 400 of the edit route, Switch to an instance keeping the search.
- `recently-opened-tables-are-offered-when-no-tab-is-open`: the first-visit text, the five recently opened tables, reload, reopening.
- `no-match-and-empty-tables-say-so`: No row matches with Clear filters and Search all instances, a table with no rows.
- `a-refused-read-shows-the-error-and-try-again-reads-it-again`: Couldn't load with its status, Try again, Check connection.
- `rows-per-page-offers-exactly-25-50-100-and-200`: the footer menu lists exactly the four sizes and each pages that many rows.
- `a-filter-is-either-contains-or-is-exactly-in-the-dialog-and-in-a-column-funnel`: Add filter and the header funnels offer exactly the two modes.

## How to get to it (user POV)

- Sidebar: Database › Data browser, or `/modules/database/data`; from the Schemas page's Browse data, the diagram and the overview through `?schema=<schema>&table=<table>[&instance=<name>|all]`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" data
```

## Gotchas

- The playground's `shop` schema has the products of the default instance and of eu and us, with the orders, customers and order items of eu and us only; `metrics.readings` has 1,250 rows; `vault.accounts` has two rows written by `playground/src/browse-fixtures.ts`.
- Unsorted rows come in stored order, which is not the order of the ids: journeys sort by a column or take the order from the API.
- Single-instance rows carry `_instance` on MongoDB; the grid hides the column outside All instances.
- A journey that needs a failing server injects the failure with a page route (`page.route`) in the browser; the product code is untouched.
- The drawer's J and K and the Previous and Next buttons are the DMS row header's, driven with the focus in the drawer.

## Coverage

| Documented behaviour | Journey and check |
|---|---|
| docs/4.usage/4.data-browser.md:8 pick a schema, an instance and a table on the left; open several tables as tabs | `the-sidebar-counts-each-table-in-the-picked-instance`, `tables-open-as-preview-tabs-and-are-kept-on-demand` |
| :14 Search rows (`Ctrl /`) searches the open table | `search-filters-and-sort-narrow-and-order-the-rows` "Search rows"; `list-filters-search-and-counts-follow-the-wire-tokens` |
| :14 Add filter (`contains` or `is exactly`) | `search-filters-and-sort-narrow-and-order-the-rows` "Add filter", "the header funnel" |
| :15 column headers sort | `search-filters-and-sort-narrow-and-order-the-rows` "sorting by a header" |
| :15 25, 50, 100 or 200 rows per page | `the-footer-pages-1250-rows-with-exact-ranges-at-every-size`, `list-clamps-the-page-and-orders-the-rows` (the API caps at 200) |
| :16 `Space` opens the row, "Row 3 of 50", previous and next, `J` and `K` | `the-row-drawer-steps-through-the-page-with-j-and-k` |
| :16 Fields tab, long text or JSON takes the width, dashed circle sets null, the footer counts unsaved changes | `the-fields-tab-widens-long-values-and-sets-null-with-the-dashed-circle` |
| :16 JSON tab and Referenced by tab | `the-row-drawer-shows-fields-json-and-the-rows-pointing-at-it` |
| :17 Open in query console | `links-open-the-table-in-the-instance-they-name` "Open in query console" |
| :19 `?schema=shop&table=products`, `instance=<name>`, `instance=all` | `links-open-the-table-in-the-instance-they-name` |
| :21-23 All instances: read across every instance, read-only | `all-instances-is-a-read-only-view-with-the-instance-column` |
| :53 `T` finds a table | `the-sidebar-counts-each-table-in-the-picked-instance` "T finds a table" |
| :54 `Ctrl /` Search rows | `search-filters-and-sort-narrow-and-order-the-rows`, `r-refreshes-the-rows-and-the-search-shortcut-works-from-the-grid` |
| :55 `R` Refresh | `r-refreshes-the-rows-and-the-search-shortcut-works-from-the-grid` |
| :56 `Enter` edits the cell, :59 `Ctrl S` reviews and saves | the `editing` feature |
| :57 `Space` opens the row, :58 `J` and `K` | `the-row-drawer-steps-through-the-page-with-j-and-k` |
| grill Q18 the browser stays custom, discovers columns at run time | `columns-get-and-tables-answer-what-the-grid-needs` (sampled columns and types) |
| grill Q20 labelled Schema and Instance controls, "all" read-only with a strip offering to switch, `_instance` column, table list with its filter and counts that say which instance | `the-sidebar-counts-each-table-in-the-picked-instance`, `all-instances-is-a-read-only-view-with-the-instance-column` |
| grill Q21 pin button always visible on a preview tab, the one-line hint, open tables dotted in the list | `tables-open-as-preview-tabs-and-are-kept-on-demand` |
| grill Q22 removable chips with Clear all, sort arrows where active | `search-filters-and-sort-narrow-and-order-the-rows` (chips, aria-sort) |
| grill Q23 row drawer, Referenced by counts from `GET /browse/references`, J / K | `the-row-drawer-shows-fields-json-and-the-rows-pointing-at-it`, `references-count-the-rows-pointing-at-a-row` |
| grill Q24 Pick a table to browse with the recently opened tables | `recently-opened-tables-are-offered-when-no-tab-is-open` |
| grill Q24 No match: Clear filters / Search all instances | `no-match-and-empty-tables-say-so` |
| grill Q24 Load error: Try again with the error text | `a-refused-read-shows-the-error-and-try-again-reads-it-again` |
| docs/5.extending.md:77 `/modules/database/data?schema=&table=` opens the table | `links-open-the-table-in-the-instance-they-name` |
| docs/5.extending.md:78 `/modules/database/query?schema=&table=` opens the console on that table | Not driven: the Query console's feature owns that page |
| README:21 browses rows in any instance | `the-sidebar-counts-each-table-in-the-picked-instance`, `links-open-the-table-in-the-instance-they-name`, `all-instances-is-a-read-only-view-with-the-instance-column` |
| `GET /browse/list`, `count`, `columns`, `tables`, `references`, `get` | the six API journeys above |
| `GET /tables/instances` (the instance picker) | `the-instance-picker-lists-named-instances-with-a-search-and-a-limit`; the sidebar journey picks eu and us from it and reads No named instance for `metrics` |
| `GET /tables/source` | Not driven here: only the Schemas page reads it |
| Owner only | `the-browse-api-answers-the-platform-owner-only` |
| Footer pages through the rows (25, 50, 100 or 200 per page) | 4.data-browser.md:15 | `rows-per-page-offers-exactly-25-50-100-and-200` |
| Add filter adds a column filter (`contains` or `is exactly`) | 4.data-browser.md:14 | `a-filter-is-either-contains-or-is-exactly-in-the-dialog-and-in-a-column-funnel` |
