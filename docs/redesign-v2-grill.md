# dms-database v2 redesign: self-answered grill session

This is the decision log behind the pull request that ports dms-database to
`@antelopejs/dms` 0.6 / `@antelopejs/interface-dms` 0.4 /
`@antelopejs/dms-frontend` 0.5 and to the v2 design mockup
(`modules/database/*` and its UX review, findings D-01 to D-17).

It was run as a "grill me" session where every question got the recommended
answer and that answer was taken. Read it top to bottom: later answers build
on earlier ones. Each answer names what it rests on (a file, a migration-guide
section, a mockup finding) so a reviewer can challenge the premise rather than
the conclusion.

## 1. Scope and dependencies

**Q1. Which packages move, and to which ranges?**
Every AntelopeJS dependency moves to its latest release line:
`@antelopejs/interface-dms` `>=0.4.0 <1.0.0` (the DMS itself caps the interface
below its next minor; a module keeps the range wide so every module resolves
the same copy, which `antelopejs-check-interface-ranges` enforces),
`@antelopejs/dms` `>=0.6.0
<0.7.0` (dev and playground), `@antelopejs/dms-frontend` `>=0.5.0 <0.6.0` (dev,
playground and the layer's `engines`), `@antelopejs/core` `>=1.13.5 <2`,
`@antelopejs/interface-api` `>=0.0.14`, `@antelopejs/interface-dms-automation`
`>=0.1.1`, and in the playground `@antelopejs/mongodb` `^1.4.2` (required by the
DMS 0.6 for `$`-prefixed strings) and `@antelopejs/api` `^1.3.3`. The other
interfaces are already on their latest release.

**Q2. Which breaking changes of interface-dms 0.4 touch this module?**
Read against the migration guide, only a handful do. The module has no
`TableView` over a data controller, no `Form`, no settings page and no
notification, so the table-view, form, settings and notification sections do
not apply. What applies:
- `<DmsBanner color>` became `tone` (Frontend APIs table): the overview banner.
- Tone vocabulary: `accent`/`ok` are gone; the schema label colours already
  used the seven `Tone` names, so `SchemaLabelColor` becomes an alias of `Tone`.
- `DmsTable`, `DmsEmpty`, `DmsPagination` and the other `build/` components are
  private. The module only used the public `DmsTableView`, `DmsCard`,
  `DmsKpiCard`, `DmsStatusSummary`, `DmsActivityItem`, `DmsSegmented`,
  `DmsFlowCanvas` and `DmsChart`, which all stay public.

**Q3. And the breaking changes of dms-frontend 0.4 / 0.5?**
Both apply and both break the layer today (`ajs dms verify-source` reports 60
type errors on `main` once the DMS is bumped):
- 0.4 auto-imports nothing from a module without `dms.frontend.build.ts`. The
  layer relied on auto-imports of its own `app/composables` and `app/utils`.
  Declaring them would make `useQueryStore`, `isFilterToken` and the rest
  global names of every module's code; they move under `app/build/` instead,
  private by the DMS convention and imported by path, and the layer declares no
  auto-import at all.
- 0.5 puts a `componentPrefix` in front of every registered name and no longer
  strips a leading `Dms`. The layer declares `componentPrefix: "DmsDatabase"`
  and registers bare file names, so `DataGrid.vue` keeps resolving as
  `DmsDatabaseDataGrid` and the backend keeps sending that full name.

## 2. Information architecture

**Q4. Does the module keep four pages?**
No, five. The mockup's nav (`js/modules/database.js`) and finding D-06 give the
diagram its own entry: *Explore* (Overview, Schemas, Diagram) and *Work with
data* (Data browser, Query console). The two headings are label categories
under the module root with `urlSlug: "/"`, the way the DMS playground files its
sections, so page URLs stay `/modules/database/<page>` and existing links keep
working. Only the permission ids gain the category segment.

**Q5. Does the "UX review" entry of the mockup become a page?**
No. It is the mockup's audit of the old module, not a product screen.

**Q6. How are pages described now?**
On the backend, as block trees (the user's requirement, and the direction of
DMS 0.6, whose own settings pages became block trees). Every page uses the
standard DMS page header (D-17): no more `hideHeader` and hand-made 48px icon
headers. A custom Vue component is only used where no DMS block can render the
screen, and every custom component carries `.meta({ name, icon, description })`
with `$dms_database.*` i18n keys so the permission tree reads well.

**Q7. Module pages are owner-only and never listed in the Roles tree
(distributable-module docs). Is `.meta()` still worth it?**
Yes. The permission ids exist (`modules.database.…`), the page editor and the
permission preview read the same metadata, and the docs promise module-scoped
ids may become grantable. Writing them now costs nothing and keeps every
position named in both locales. The routes keep `@AuthOwnerOnly()`: modules are
owner-only administration spaces by convention.

## 3. Overview (D-01, D-08)

**Q8. Which blocks build the overview?**
Top to bottom, following `modules/database/index.html`:
1. Header actions on `DefaultLayout`: "Open query console" (secondary) and
   "Browse data" (lead), as page targets.
2. A small `Banner` (tone `warning`, size `sm`, dismissible with a versioned
   `dismissKey`) carrying the one honest line of D-01: saved edits are written
   straight to the database; structure editing comes later.
3. A custom `DmsDatabaseConnectionStatus` around the public `DmsStatusSummary`:
   connection, probe latency, tables in N schemas, rows, indexes, with the
   driver label and "checked N s ago". There is no status block in
   interface-dms, so this is the one custom piece. The dead "Pool" metric and
   the duplicated KPI row are dropped (D-08).
4. A `Section` "Schemas" (bare) holding a `NavCardGrid` fed by
   `GET /api/database/overview/schemas`: one card per schema with its label,
   its instance count as `tag`, and tables / rows / relations as `readout`,
   linking to the Schemas page on that schema. Its `empty` text is the "No
   schema registered yet" state.
5. A `Grid` row with a `TopListCard` "Largest tables" (`showBar`, fed by
   `GET /api/database/overview/largest`, each row linking to the data browser)
   and an `ActivityFeed` "Recent queries" (`mono`, no day grouping, five items,
   fed by `GET /api/database/overview/recent-queries`, tone by status).

**Q9. Why not keep the schema card's table chips and two buttons?**
`NavCardGrid` is the existing block for "a grid of cards that lead somewhere",
and the redesign asks to reuse blocks before writing components. The readout
line carries the same numbers; the card leads to the schema's tables, and the
diagram is one click away in the nav and from every table.

**Q10. What does the connection-lost state show?**
The status component turns `down` with the last error and when the last
success was. The health route already probes; it now also returns the probe
error message. The data pages are not paused: each one shows its own load
error with a retry.

## 4. Schemas (D-06, D-07)

**Q11. Is the schema list still a custom table?**
No. It is a `TableView.fromSource` over a new
`GET /api/database/tables/source` route, the DMS block made exactly for "a
module route's rows, read-only". The route declares `search` (it matches table
**and column** names, D-06 "find a table or column") and `filter`; the browser
sorts and pages the rows. Columns: table (mono), rows, columns, indexes,
relations, modifiers.

**Q12. Schemas are registered at runtime; tabs are declared at page
registration. How do the schema tabs of the mockup exist?**
Through the per-request `onFilter` hook: the page wraps the table view's own
filter chain and appends one filter tab per registered schema (`schema is
<id>`), served with the request. The table view counts each tab through the
route (`limit=1`), so tab counters come for free.

**Q13. What does clicking a table do?**
It opens the table inspector, a custom row action marked `isDefault` with
`deepLink: true`, whose target is a drawer rendering the custom
`DmsDatabaseTableInspector`. J / K step through the tables (built into row
drawers). The DMS opens a row action's drawer from the bottom; the diagram
opens the same inspector from the right, through `useDrawer`. The inspector follows D-07: no fake "Healthy" footer; facts (rows,
columns, indexes, relations, instances); tabs Columns, Indexes, Relations
(references and referenced-by), Sample row; actions Browse data, Query this
table, Show in diagram, Copy name. The other row actions (Browse data, Query,
Diagram) are custom row actions with page targets interpolating `{schema}` and
`{name}`.

**Q14. Where does "referenced by" come from?**
From the introspected relations of every schema, reversed. The inspector gets
them from `GET /api/database/schemas` like the rest of its data.

## 5. Diagram (D-09, D-10)

**Q15. Does the diagram stay on DmsFlowCanvas?**
Yes, it is the DMS's flow wrapper and dms-database is already its documented
consumer. The page is a custom `DmsDatabaseSchemaDiagram` with a schema picker
in its toolbar (deep link `?schema=`).

**Q16. What changes in the diagram?**
- Type colours go (D-09): each column shows its type as mono text with a
  neutral icon; colour only marks structure, warning for primary keys and info
  for relation columns and edges. A legend sits in a panel. The minimap is on.
- Selecting a table highlights its edges and the related columns.
- Positions save as soon as a drag ends, "Layout saved · N ago", with undo and
  redo (D-10). No Apply / Cancel, no `window.confirm`.
- Auto layout previews first, with "Keep layout" / "Discard", because it moves
  every table at once.
- Notes keep working; they already saved on their own.

**Q17. Per user or per team layouts?**
Per schema, shared by the team, as today (the mockup says "your layout is saved
for the whole team"). The review's backend note about per-user layouts is not
taken: nothing asks for it.

## 6. Data browser (D-02, D-04, D-05, D-14, D-15)

**Q18. Can the data browser become a TableView?**
No. Its rows come from any registered table with columns discovered at run
time, it edits cells inline and spans several open tables. That is the job of
the custom studio. It stays custom and is redesigned in place.

**Q19. How do edits behave now (D-02, the main high-severity finding)?**
Staged. A committed cell no longer writes: it turns warning-tinted with the
old value struck through, the tab gets a dot, and a changes bar shows "N
unsaved changes · Discard · Review · Save (⌘S)". Review opens a diff modal
(row, column, before → after). Saving writes one `PUT /browse/edit` per row
with all its changed fields, then a toast offers Undo for a few seconds, which
writes the previous values back. Leaving the page with staged edits asks, via
the DMS leave guard.

**Q20. How is scope shown (D-04)?**
The sidebar gets labelled Schema and Instance controls; instances are a
`DmsSegmented` (`default · <named> · all`), with "all" marked read-only. In
"all", a read-only strip explains it and offers to switch to one instance; the
`_instance` column is shown. The table list has its own filter field and its
row counts say which instance they count.

**Q21. Preview tabs (D-05)?**
Kept, but explicit: the pin button is always visible on a preview tab, the tab
bar carries the one-line hint, and open tables are dotted in the list.

**Q22. Filters (D-14)?**
Active filters become removable chips under the toolbar (column · mode ·
value) with "Clear all". Header funnels and sort arrows are always visible
where active.

**Q23. Row drawer?**
Yes: a "open row" button on the row number (and Space) opens a drawer with the
row's Fields (editable, staged like cells), JSON and Referenced by (a count
per inbound relation, from a new `GET /browse/references` route), with J / K.

**Q24. Empty and error states (D-15)?**
First visit: "Pick a table to browse" with the recently opened tables. No
match: Clear filters / Search all instances. Load error: Try again, with the
error text. All drawn with the public `DmsEmptyState`.

## 7. Query console (D-03, D-11, D-12, D-13)

**Q25. What does the mutation guard become (D-03)?**
It runs a dry run first. A new `POST /api/database/query/dry-run` decodes the
staged query, finds the first mutating stage and counts the rows the stages
before it select (an insert counts its documents). The modal names the
operation, `table @instance` and the row count, and the button says what will
happen ("Update 1 row", "Delete 214 rows"). Deletes and multi-row changes
always ask and need the table name typed (the DMS confirm dialog's
`confirmText`). Only single-row updates can be skipped, until the browser tab
is closed (session storage, not local storage): the browser cannot tell a
sign-out from here, so the wording says what really happens.

**Q26. History and saved queries (D-11)?**
One library rail with tabs History · Saved · Team, one search field, entries
grouped by day, a status dot per run. History records failures too: the
execute route stores `status` (`ok`, `error`), the error message and whether
the query changed data, so the rail can show fast / slow / failed / changed.
Old history rows without a status read as `ok`.

**Q27. Editor (D-12)?**
The single-option language select goes. The hard-coded
`schemas.shop…` example goes; the footer offers insertable snippets built on a
real table of the workspace, the cursor position and the completion shortcut.
Table completions show their row counts.

**Q28. Results (D-13)?**
The result header shows rows, duration and whether the query read or wrote,
with Copy JSON and Export CSV. A footer states that all rows are shown, or
that the result was cut: the execute route caps the rows it returns at 1,000
and says how many there were. The chart gets explicit X and Y pickers. When
the query targets one table, "Open in data browser" links to it.

**Q28b. Keyboard shortcuts (D-17)?**
Every shortcut the module binds is listed on the dashboard's Shortcuts
settings page through `app/config/shortcuts-registry.ts`, the DMS convention.
The row search takes ⌘ / (Ctrl / elsewhere) like every DMS page search: "/"
alone belongs to the navigation search.

## 8. Vocabulary and i18n (D-16)

**Q29. Which words?**
"table" and "row" everywhere ("collection", "element" go). Buttons say what
happens. Every new string exists in en-GB and fr-FR.

## 9. Testing

**Q29b. Which bugs did the pass find in the existing module?**
- A query reaching every instance (`instance(CROSS_INSTANCE)`) lost the symbol
  on the way to the server (JSON drops symbols) and ran on the default
  instance: it now travels as a sentinel.
- A store answers no row for a table that does not exist, so a mistyped table
  read as an empty one: the console now names the unknown table, records the
  failed run, and offers the closest table.
- A schema whose rows all live in named instances showed only its decorated
  columns: column inference now samples a named instance when the default one
  is empty, and ignores the `_instance` tag.
- Editing a date cell stored it back as text: the edit route keeps a date a
  date. And a cell could not be cleared: `null` now clears it.
- The overview linked rows with `NuxtLink`, which the Vue frontend does not
  have: every link now goes through the DMS link components.

**Q30. What proves it works?**
- `pnpm lint`, `pnpm typecheck`, `pnpm knip`, `pnpm build`.
- `pnpm test`: the existing integration suite, plus tests for the new routes
  (tables source search on columns, overview feeds, dry run counts, history
  status, references).
- `pnpm --dir frontend-vue test` (vitest) for registration and the pure
  helpers (staged edits, dry-run wording).
- `pnpm test:frontend` (`ajs dms verify-source`) for the layer's types and
  build against the DMS 0.6 layer.
- A manual pass of every page in the playground, in both themes, with
  screenshots, fixing what it finds.
