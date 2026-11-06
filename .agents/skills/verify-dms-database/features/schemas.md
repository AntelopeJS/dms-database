---
covers:
  - src/pages/schemas.ts
  - src/routes/tables.ts
  - src/routes/schemas.ts
  - src/service/schemaFilters.ts
  - src/service/introspect.ts
  - src/service/declaredFields.ts
  - src/service/fieldDescriptor.ts
  - src/service/schemaRegistry.ts
  - src/service/types.ts
  - src/types/**
  - src/utils/guards.ts
  - frontend-vue/app/components/SchemasFilterBar.vue
  - frontend-vue/app/components/SchemaPicker.vue
  - frontend-vue/app/components/InstancePicker.vue
  - frontend-vue/app/components/TableInspector.vue
  - frontend-vue/app/components/DrawerTabs.vue
  - frontend-vue/app/build/schemas/**
  - frontend-vue/app/build/composables/useDatabaseSchemas.ts
  - frontend-vue/app/build/composables/useTableSample.ts
  - frontend-vue/app/build/utils/fieldTypes.ts
  - frontend-vue/app/build/utils/databaseLinks.ts
docs:
  - docs/4.usage/2.schemas.md
---

# Schemas

The Schemas page lists every table the loaded modules register, with the rows counted in the picked instance and the column, index and relation counts. A filter bar narrows the list and keeps its state in the URL, and a row opens an inspector drawer with the table's columns, indexes, relations and a sample row.

## Sub-features

- `the-source-counts-rows-columns-indexes-relations-and-modifiers-of-each-table`: the source route's exact figures for ten known tables, `all` equal to the tables the schemas route registers.
- `schema-instance-search-and-structure-filters-narrow-the-source-and-combine`: scope, name or column search (case, trim), relations, modifiers, empty, combinations, unknown flags, `all` unchanged by filters.
- `rows-are-counted-in-the-picked-instance-default-named-or-all`: default, `eu`, `us`, `all` and an unknown instance, and `empty` judged in the picked instance.
- `the-instances-route-searches-sorts-and-limits-the-named-instances-of-a-schema`: search, numeric sort, limit and its clamps, 400 and 404.
- `a-table-is-read-by-its-schema-and-name-id`: the single-table route and its refusals.
- `columns-are-declared-in-code-and-inferred-from-sampled-rows`: declared columns first, sampled columns after, nulls as unions, arrays by element, no instance tag, a column named `constructor`.
- `the-tables-and-schemas-routes-answer-the-platform-owner-only`: 401 without a session, 403 for a member.
- `each-filter-of-the-bar-narrows-the-list-and-sets-its-own-url-key`: every filter in the UI, its URL key, the `N of M tables` count only while filtered.
- `the-url-restores-every-filter-after-a-reload-and-clear-removes-them`: shared link, reload, Clear, Escape, another schema dropping a named instance.
- `slash-focuses-the-search-field-but-not-while-typing-or-with-a-modifier`: the `/` shortcut.
- `a-filter-that-matches-nothing-says-no-result-and-clear-filters-restores-the-list`: the empty state.
- `each-of-the-five-sortable-columns-sorts-both-ways-and-the-third-click-restores-the-default-order`: Table, Schema, Rows, Columns, Indexes; Relations and Modifiers do not sort.
- `the-relations-and-modifiers-columns-name-the-tables-and-the-flags`: the tag columns and the table heading count.
- `a-row-click-opens-the-inspector-and-previous-next-j-and-k-step-through-the-list`: header, `Table N of M`, `?record=`, buttons, `J`/`K`, ends, Close, direct open, a record outside the list, an unknown record.
- `dragging-the-drawer-edge-resizes-it-and-it-opens-at-the-width-you-left-it`: drag the edge both ways, reopen and step.
- `the-inspector-states-the-counts-and-lists-each-column-with-its-type-null-and-notes`: facts in singular and plural, Columns tab, Null, notes.
- `a-column-named-constructor-is-listed-like-any-other-column`: FAILS on the current product (see Gotchas).
- `the-indexes-and-relations-tabs-list-what-the-table-declares-and-a-relation-opens-the-other-table`: compound versus single, out and in, a relation opens the other table, another schema's table, empty tabs.
- `the-sample-row-tab-shows-one-row-and-another-row-pages-through-the-table`: labels, wrap-around, named and default instance, empty and one-row tables.
- `browse-query-and-diagram-actions-open-the-other-pages-on-the-same-table`: the three inspector actions, the row menu, the header Diagram button.
- `with-modifiers-keeps-a-table-with-only-a-hashed-only-a-localized-or-only-an-encrypted-column`: the "or" of the With modifiers filter: three single-modifier tables of the `mods` schema stay in the API and in the list, each flagging only its own modifier.
- `a-narrow-inspector-scrolls-its-columns-table-and-its-tabs-sideways`: the drawer narrowed to its minimum scrolls the columns table and the tab strip sideways.

## How to get to it (user POV)

- Modules › Database › Schemas (`/modules/database/schemas`); `?scope=&instance=&q=&has=` filter, `?record=<schema>::<table>` opens an inspector.

## Driving it with dms-control

```bash
dms-control journey "$RUN" schemas
```

## Gotchas

- The playground registers DMS's own schemas too (`dms-core`, `dms-tenant`, `dms-database`), so unscoped counts move with the run; journeys scope to `shop`, `vault`, `links`, `metrics`, `demo` or read `all` from the API.
- `a-column-named-constructor-is-listed-like-any-other-column` fails: opening the inspector of `quirks.members` (a column named `constructor`) renders an empty body, and the deep link answers a 500. Draft: `~/.cache/campaign/issues/dms-database-constructor-column.md`.
- Clicking the header of the column the list is sorted by by default (Rows) does nothing visible; the journey leaves the default sort first.
- The query page drops `schema` and `table` from its URL after it prefills the editor, so its check reads the editor.

## Coverage

| Documented behaviour | Doc | Journey and check |
| --- | --- | --- |
| Schema filter shows one schema's tables | 2.schemas.md:20 | filters (API) and each-filter (`scope=shop`, four tables) |
| Instance counts default, a tenant or region, or all | 2.schemas.md:21 | rows-are-counted..., each-filter (eu, all, default) |
| Find a table or column, `/` focuses | 2.schemas.md:22 | filters (name, column, trimmed, any case), each-filter, slash |
| With relations / With modifiers / Empty | 2.schemas.md:23-25 | filters, each-filter (chips, fixed order) |
| Every filter is kept in the URL | 2.schemas.md:16 | each-filter, the-url-restores... (reload) |
| Sort by name, schema, rows, columns, indexes | 2.schemas.md:27 | each-of-the-five-sortable-columns... |
| Relations column names the tables; Modifiers flags | 2.schemas.md:27 | the-relations-and-modifiers-columns... |
| N of M tables count | 2.schemas.md:20 (bar) | each-filter (count text), no-result |
| Click a row opens the inspector; `Table 3 of 87`; previous/next, `J`/`K`; URL `?record=` | 2.schemas.md:31 | a-row-click-opens-the-inspector... |
| Drag the edge to resize; opens at the width last left | 2.schemas.md:31 | dragging-the-drawer-edge... |
| Row, column, index, relation counts | 2.schemas.md:35 | the-inspector-states-the-counts... |
| Columns tab: type naming, Null, notes | 2.schemas.md:37 | the-inspector-states-the-counts... |
| Indexes tab | 2.schemas.md:38 | the-indexes-and-relations-tabs... |
| Relations tab, a relation opens the other table | 2.schemas.md:39 | the-indexes-and-relations-tabs... |
| Sample row tab | 2.schemas.md:40 | the-sample-row-tab... |
| Browse data, Query this table, Show in diagram; same in the row menu | 2.schemas.md:42 | browse-query-and-diagram-actions... |
| No result and Clear filters | design, schemas.ts | a-filter-that-matches-nothing... |
| On a narrow drawer the table and tabs scroll sideways | 2.schemas.md:37 | `a-narrow-inspector-scrolls-its-columns-table-and-its-tabs-sideways` |
| First-run empty state (No table registered yet) | schemas.ts | Not driven: the playground always registers tables |
| API routes and own-key lookups | src/routes/tables.ts, introspect.ts | the API journeys; the own-key case is the failing `constructor` journey |
| With modifiers keeps the tables with hashed, localized or encrypted columns (single-modifier tables) | 2.schemas.md:24 | `with-modifiers-keeps-a-table-with-only-a-hashed-only-a-localized-or-only-an-encrypted-column` |
