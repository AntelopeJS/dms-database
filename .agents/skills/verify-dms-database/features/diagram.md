---
covers:
  - src/pages/diagram.ts
  - src/routes/diagram.ts
  - src/db/models/diagram_*.ts
  - src/db/tables/diagram_*.ts
  - frontend-vue/app/components/SchemaDiagram.vue
  - frontend-vue/app/components/DiagramNoteNode.vue
  - frontend-vue/app/components/DiagramRelationEdge.vue
  - frontend-vue/app/components/DiagramStubNode.vue
  - frontend-vue/app/components/DiagramTableNode.vue
  - frontend-vue/app/build/components/Diagram*
  - frontend-vue/app/build/components/diagramFloat.css
  - frontend-vue/app/build/diagram/**
  - frontend-vue/app/build/composables/useDiagram*.ts
docs:
  - docs/4.usage/3.diagram.md
---

# Diagram

The Diagram page draws the tables of one schema and the relations between them, folds wide tables, keeps one layout and the notes for the whole team, and previews an automatic arrangement before it is kept.

## Sub-features

- `the-layout-api-stores-one-layout-per-schema-and-refuses-bad-positions`: PUT and GET of the layout, replacement, isolation per schema, 400 refusals.
- `the-notes-api-creates-lists-updates-and-deletes-notes-per-schema`: note CRUD and its fields.
- `the-notes-api-refuses-missing-numbers-with-400-and-unknown-notes-with-404`: note refusals.
- `every-diagram-route-answers-the-platform-owner-only`: 401 and 403 on all six routes.
- `tables-list-their-columns-with-types-and-icons-and-relations-are-arrows`: columns, types, icons against the legend, arrows, labels.
- `an-encrypted-column-carries-the-lock-icon-of-the-legend`: modifier icons.
- `a-table-of-more-than-twelve-columns-comes-folded-and-folding-is-not-saved`: the fold, `+ 5 columns`, click, Enter, Fold columns.
- `folding-is-a-setting-of-your-own-view-and-is-not-saved-with-the-team-layout`: unfolding writes no layout, reload and another tab fold again.
- `finding-a-column-a-folded-table-hides-unfolds-that-table`: search unfolds only for a hidden column.
- `the-fold-keeps-the-twelve-column-boundary-and-every-column-an-arrow-ends-on`: 12 versus 13 columns, singular `+ 1 column`, an arrow end beyond the twelfth.
- `a-large-schema-opens-at-forty-percent-on-its-top-left-and-fit-view-shows-it-whole`: 40 % start, overview map, `1`, `0`, Fit view.
- `a-relation-to-a-table-not-drawn-ends-on-a-dashed-chip-that-opens-that-table`: focus, chip, opens and selects the table.
- `a-relation-to-another-schema-ends-on-a-chip-that-opens-that-table`: FAILS on the current product (see Gotchas).
- `the-url-picks-the-schema-and-the-table-and-names-what-it-cannot-find`: deep link, not-found messages, schema picker and Back.
- `a-schema-without-a-table-says-so-and-offers-no-note-or-auto-layout`: No tables in X.
- `dragging-a-table-saves-the-layout-and-everyone-reads-it`: drag, Layout saved, API, reload, second tab.
- `a-table-not-placed-yet-takes-its-automatic-place-and-placed-tables-stay`: placement rule.
- `auto-layout-previews-the-arrangement-and-keep-or-discard-decides`: preview bar, count, Discard, Keep, Undo, Escape.
- `auto-layout-keeps-groups-together-and-clear-of-notes-that-never-move`: arrangement rules, folded height, notes.
- `n-and-the-note-button-drop-a-note-ready-to-write-and-it-is-saved-with-the-schema`: add notes.
- `a-double-click-edits-a-note-and-the-trash-button-and-delete-remove-it`: edit and delete.
- `notes-belong-to-their-schema-and-everyone-reads-them`: shared notes.
- `undo-and-redo-cover-every-move-and-note-and-are-saved`: Ctrl Z, Ctrl Shift Z, Ctrl Y and the buttons.

## How to get to it (user POV)

- Modules › Database › Diagram, or Show in diagram from a table (`?schema=&table=`).

## Driving it with dms-control

```bash
dms-control journey "$RUN" diagram
```

## Gotchas

- The playground adds `links` (cross-schema relation, 12, 13 and 14 column tables, named instances), `quirks` (a column named `constructor`) and `hollow` (no table), from `playground/src/bridge-schema.ts`, imported from `index.ts`.
- A cross-schema chip opens the other schema's diagram but does not select or centre the table: `a-relation-to-another-schema-ends-on-a-chip-that-opens-that-table` fails. Draft: `~/.cache/campaign/issues/dms-database-diagram-cross-schema-chip.md`.
- Icons are inline sprites; journeys compare them with the legend's by sprite id.
- In focus mode the selection bar lies over the chip, so the journey presses the chip through its click handler.
- The auto layout of `vault` is pinned to exact positions at a 1440 by 900 viewport.

## Coverage

| Documented behaviour | Doc | Journey and check |
| --- | --- | --- |
| Pick the schema, `?schema=&table=` opens a table | 3.diagram.md:8 | the-url-picks-the-schema... |
| Columns with types; icons for key, relations, objects, encrypted; legend | 3.diagram.md:14-16 | tables-list-their-columns..., an-encrypted-column... |
| Relation arrow from the column to its table | 3.diagram.md:16 | tables-list-their-columns... (edges, labels, markers) |
| Dashed chip to a table not drawn, opens it | 3.diagram.md:16 | a-relation-to-a-table-not-drawn... ; another schema: failing |
| Fold rule: 12 columns, key, arrow ends, `+ N columns`, click or Enter, Fold columns | 3.diagram.md:18 | a-table-of-more-than-twelve..., the-fold-keeps-the-twelve... |
| Finding a hidden column unfolds the table | 3.diagram.md:18 | finding-a-column... |
| Folding is not saved with the layout | 3.diagram.md:18 | folding-is-a-setting-of-your-own-view... |
| Large schema opens at 40 %, top-left, overview map, Fit view `1` | 3.diagram.md:20 | a-large-schema-opens-at-forty-percent... |
| Double-click opens the inspector drawer titled with the table, relation opens the other table, no position, no `J`/`K` | 3.diagram.md:22 | Not driven: no journey written in this round |
| Drag tables, Layout saved, shared by everyone | 3.diagram.md:26 | dragging-a-table-saves-the-layout... (everyone means platform owners, the routes are owner-only) |
| Auto layout preview with Keep layout / Discard | 3.diagram.md:26 | auto-layout-previews-the-arrangement... |
| Arrangement rules, folded height, clear of notes, placement of unplaced tables | 3.diagram.md:28 | auto-layout-keeps-groups-together..., a-table-not-placed-yet... |
| Tables without relations sorted by prefix before `__` | 3.diagram.md:28 | Not driven: the interface refuses `__` in table names, no registered table has a prefix |
| Undo and redo cover every move | 3.diagram.md:26 | undo-and-redo-cover-every-move... |
| Note button and `N`, double-click to write, saved with the schema, shared | 3.diagram.md:32 | n-and-the-note-button..., a-double-click-edits..., notes-belong-to-their-schema... |
| Shortcut `F`, `N` | 3.diagram.md:38-39 | `N`: n-and-the-note-button...; `F`: finding-a-column... (focus by typing in the field) |
| Shortcuts `1`, `0` | 3.diagram.md:41 | a-large-schema-opens-at-forty-percent... |
| Shortcuts `V` / `H` | 3.diagram.md:40 | Not driven: no journey written in this round |
| Shortcuts Ctrl Z, Ctrl Shift Z, Ctrl Y | 3.diagram.md:42-43 | undo-and-redo-cover-every-move... |
| Shortcut `Esc` | 3.diagram.md:44 | auto-layout-previews... (discards the preview); focus and selection steps Not driven |
| The Shortcuts settings page lists them | 3.diagram.md:46 | Not driven: no journey written in this round |
| Schema ... not found, Table ... not found, No tables in X | design, SchemaDiagram.vue | the-url-picks-the-schema..., a-schema-without-a-table... |
| Layout and notes API | routes/diagram.ts | the API journeys |
| Layout and notes survive a backend restart | 3.diagram.md:26 | Not driven: no journey written in this round |
