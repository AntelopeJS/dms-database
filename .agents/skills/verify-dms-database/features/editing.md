---
covers:
  - src/service/rowEdit.ts
  - src/service/stagedSerialization.ts
  - src/routes/data.ts
  - frontend-vue/app/components/JsonCellPanel.vue
  - frontend-vue/app/build/data/stagedEdits.ts
  - frontend-vue/app/build/data/stagedWrites.ts
  - frontend-vue/app/build/data/useStagedSave.ts
  - frontend-vue/app/build/data/cellValues.ts
  - frontend-vue/app/build/utils/stagedSerialization.ts
  - frontend-vue/app/build/components/DataGridSaveStatus.vue
docs:
  - docs/4.usage/4.data-browser.md
  - docs/6.faq.md
  - README.md
---

# Editing

Staged edits of the Data browser: a cell or a drawer field is staged with the old value struck through, the bar counts the changes, Ctrl S lists every change before anything is written, Save writes one PUT per row, Undo writes the previous values back for ten seconds, and the rows written are read back through the API, the query console, a reload and a fresh tab.

## Sub-features

- `edits-are-staged-then-reviewed-then-written-one-put-per-row`: typing a cell stages it (old value struck, tab dot, bar), the review lists row, column, before and after, Keep editing writes nothing, Save sends one PUT per row with all its fields, and the API, the query console, a reload and a fresh tab read the new values.
- `invalid-drafts-are-refused-esc-cancels-and-a-click-away-decides`: the number, boolean and date messages with `Esc to cancel`, the empty and impossible drafts, an unchanged value, a click away.
- `null-empties-a-cell-and-backslash-null-is-the-text-null`: `null`, `\null`, `\\null`, an emptied text, and the editor's escaped display of the text null.
- `object-and-array-cells-open-the-json-editor-in-a-side-drawer`: the JSON editor drawer (resize by its edge), Invalid JSON, the scalar refusal, Cancel, Apply, null, and nested values stored as typed.
- `the-json-editor-is-as-tall-as-the-drawer`: the JSON editor fills the drawer's height down to its footer.
- `discard-and-closing-a-tab-with-staged-changes-ask-first`: Discard, the kept preview tab, the close dialog with the count, singular and plural, and the leave guard.
- `undo-writes-the-previous-values-back-within-the-window`: Undo restores values, null and a nested value in one PUT, announces the undone changes, and a new edit ends the offer.
- `undo-is-offered-for-ten-seconds-then-the-values-stay`: Undo disappears 9.9 to 11.5 seconds after the click on Save, in real time, and the values stay.
- `a-row-deleted-meanwhile-drops-its-changes-and-the-rest-is-saved`: the rows-gone message and partial title, the page read again, and the undo of a row deleted since.
- `a-failed-write-stops-the-save-and-the-rows-left-stay-staged`: a write that fails (injected in the browser), the rows left staged, a retry, and a save where nothing is written.
- `a-saved-row-shows-in-place-unless-the-save-may-move-rows`: the README sentence, with another writer's change as the witness of a page read again.
- `a-save-under-a-search-or-a-filter-reads-the-page-again`: a filtered field and a search read the page again, another field of a filter does not.
- `an-edit-and-its-undo-land-in-the-instance-of-the-tab-only`: a row with one id in the default, eu and us instances.
- `saved-cells-keep-their-type-numbers-booleans-dates-and-objects`: the column types the API infers from the stored rows after a typed edit.
- `the-edit-route-writes-typed-values-and-refuses-the-rest`: the PUT's rules, read from `rowEdit.ts`.
- `hashed-encrypted-and-localized-columns-are-written-as-typed`: the warning, driven on `vault.accounts`.
- `the-row-drawer-stages-edits-like-the-cells-do`: the drawer's fields stage with the same messages, and its footer and the bar count the same changes.
- `discard-drops-the-changes-of-every-staged-row`: Discard with changes on three rows empties the bar, restores every cell and writes nothing.

## How to get to it (user POV)

- Data browser: double-click a cell or press `Enter` on it, `Ctrl S` to review and save; the row drawer (`Space`) edits a row's fields.

## Driving it with dms-control

```bash
dms-control journey "$RUN" editing
```

## Gotchas

- The bar's status line names the changed fields (`Unsaved changes · name, price`); the count is on the **Review and save N changes** button, the tab dot and the drawer's footer.
- The Undo window is measured from the click on Save; the journey polls for the button and asserts the 9.9 to 11.5 second range.
- Row identities: a cell is found by the text of the row's `_id` cell and the column's header; unsorted rows are in stored order.
- A write that fails is injected with `page.route` in the browser (HTTP 500 for one row's PUT); a deleted row is deleted through the query console's route.
- `playground/src/browse-fixtures.ts` adds two rows to `vault.accounts` (the stored form of a hashed, an encrypted and a localized column), imported from `playground/src/index.ts`.
- `src/service/stagedSerialization.ts` and `frontend-vue/app/build/utils/stagedSerialization.ts` are the query console's wire format; the journeys use them to read rows back (`query-wire.mjs` encodes the same way) and to delete and insert rows.

## Coverage

| Documented behaviour | Journey and check |
|---|---|
| docs/4.usage/4.data-browser.md:27 edits are staged, never written as you type | `edits-are-staged-then-reviewed-then-written-one-put-per-row` "typed cells are staged" (the API holds the old values) |
| :32 double-click a cell, or press `Enter`, and type | `edits-are-staged-then-reviewed-then-written-one-put-per-row` (double-click), `object-and-array-cells-open-the-json-editor-in-a-side-drawer` (Enter and double-click), `null-empties-a-cell-and-backslash-null-is-the-text-null` (Enter) |
| :32 object and array cells open a JSON editor in a side drawer, wide as you resize it | `object-and-array-cells-open-the-json-editor-in-a-side-drawer` "the drawer" (dragging the edge widens drawer and editor) |
| :32 ... as tall as the drawer | `the-json-editor-is-as-tall-as-the-drawer` (the editor ends within 120 px of the footer and takes over half the drawer) |
| :32 Apply stages the value, `null` empties the cell, Cancel leaves it | `object-and-array-cells-open-the-json-editor-in-a-side-drawer` "Cancel and Apply" |
| :32 edited cells show the old value struck through | `edits-are-staged-then-reviewed-then-written-one-put-per-row` (struck value, hover title) |
| :36 the bar counts the unsaved changes; Review and save (`Ctrl S`) lists every change before anything is written | `edits-are-staged-then-reviewed-then-written-one-put-per-row` "the review lists every change" |
| :36 Discard drops them | `discard-and-closing-a-tab-with-staged-changes-ask-first` "one change, and Discard" |
| :40 saving writes the changes; for ten seconds Undo puts the previous values back | `undo-writes-the-previous-values-back-within-the-window`, `undo-is-offered-for-ten-seconds-then-the-values-stay` |
| :45 warning: a saved edit writes straight to the database, outside any module's business logic | `hashed-encrypted-and-localized-columns-are-written-as-typed` |
| :56 `Enter` edits the cell | `object-and-array-cells-open-the-json-editor-in-a-side-drawer`, `null-empties-a-cell-and-backslash-null-is-the-text-null`, `invalid-drafts-are-refused-esc-cancels-and-a-click-away-decides` |
| :59 `Ctrl S` reviews and saves | `edits-are-staged-then-reviewed-then-written-one-put-per-row` |
| FAQ 'Why can't I edit rows?' read-only in All instances | `data`: `all-instances-is-a-read-only-view-with-the-instance-column` |
| FAQ 'Can I undo a saved edit?' ten seconds, then edit again; no edit log | `undo-is-offered-for-ten-seconds-then-the-values-stay` |
| README:21 staged, reviewed, saved, undone for ten seconds | the journeys above |
| README:24 a saved row shows in place; the page is read again when a save may move rows (a sorted or filtered field, or a search) | `a-saved-row-shows-in-place-unless-the-save-may-move-rows`, `a-save-under-a-search-or-a-filter-reads-the-page-again` |
| grill Q19 a committed cell turns warning-tinted, the old value struck, the tab gets a dot | `edits-are-staged-then-reviewed-then-written-one-put-per-row` (tab dot title), `discard-and-closing-a-tab-with-staged-changes-ask-first` |
| grill Q19 one `PUT /browse/edit` per row with all its changed fields | `edits-are-staged-then-reviewed-then-written-one-put-per-row` (the recorded requests) |
| grill Q19 a toast offers Undo for a few seconds that writes the previous values back | `undo-writes-the-previous-values-back-within-the-window` |
| grill Q19 leaving the page with staged edits asks via the DMS leave guard | `discard-and-closing-a-tab-with-staged-changes-ask-first` "leaving the page" |
| grill Q23 drawer fields editable, staged like cells | `the-row-drawer-stages-edits-like-the-cells-do` |
| invalid number, boolean and date messages with Esc to cancel | `invalid-drafts-are-refused-esc-cancels-and-a-click-away-decides` |
| `null` empties the cell, `\null` is the text null | `null-empties-a-cell-and-backslash-null-is-the-text-null` |
| closing a tab with staged changes asks: Discard and close, Keep editing | `discard-and-closing-a-tab-with-staged-changes-ask-first` |
| rows that no longer exist are dropped, partial writes stay staged, the partial and undo-failed messages | `a-row-deleted-meanwhile-drops-its-changes-and-the-rest-is-saved`, `a-failed-write-stops-the-save-and-the-rows-left-stay-staged` |
| dates stay dates, a text that is no date is refused, `null` clears, the key and `_instance` are never rewritten | `the-edit-route-writes-typed-values-and-refuses-the-rest`, `saved-cells-keep-their-type-numbers-booleans-dates-and-objects` |
| edits only on one instance; an edit lands in its instance only | `an-edit-and-its-undo-land-in-the-instance-of-the-tab-only` |
| read-back through a second view (API, query console, reload, fresh tab) | `edits-are-staged-then-reviewed-then-written-one-put-per-row` and the stored-value checks of the other journeys |
| the Undo of an edit that emptied a cell writes null back | `undo-writes-the-previous-values-back-within-the-window` |
| failure to undo with a failure of the write itself (`dms_database.data.save.undo_failed`) | Not driven: the undo's write failing leaves the rows for a retry, an injected 500 on the undo PUT was not added |
| Discard drops the unsaved changes (every staged row) | 4.data-browser.md:36 | `discard-drops-the-changes-of-every-staged-row` |
