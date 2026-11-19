---
covers:
  - src/connectionAccess.ts
  - src/routes/connections.ts
  - src/pages/externalLock.ts
  - src/service/builderRefusal.ts
  - src/service/catalog.ts
  - src/service/catalogReferences.ts
  - src/service/catalogSchemas.ts
  - src/service/connectionRefusals.ts
  - src/service/connectionState.ts
  - src/service/connections.ts
  - src/service/database.ts
  - src/utils/deadline.ts
  - frontend-vue/app/components/DatabaseSwitcher.vue
  - frontend-vue/app/build/components/DatabaseSubtitle.vue
  - frontend-vue/app/build/components/DatabaseSwitcherRow.vue
  - frontend-vue/app/build/components/DataBrowserAccessBar.vue
  - frontend-vue/app/build/components/FeatureLocked.vue
  - frontend-vue/app/build/composables/registerDatabaseSwitcher.ts
  - frontend-vue/app/build/composables/reloadForSelection.ts
  - frontend-vue/app/build/composables/useDatabaseConnections.ts
  - frontend-vue/app/build/composables/useGridAccess.ts
  - frontend-vue/app/build/data/assistantOnboarding.ts
  - frontend-vue/app/build/data/databaseOptions.ts
  - frontend-vue/app/build/data/readOnlyReason.ts
  - frontend-vue/app/build/composables/useLockedPages.ts
  - frontend-vue/app/build/composables/useSelectionRecheck.ts
docs:
  - docs/4.usage/6.external-databases.md
  - docs/3.configuration.md
---

# External

The databases a project connects to but does not own: the switcher, the Overview, Schemas and Data browser on one, the pages it cannot serve, and the access that lets the console write to it.

## Sub-features

- `an-external-database-is-picked-browsed-edited-and-left`: `erp` is listed next to the project database, picked in the switcher, browsed (rows, inspector, sample row, the Diagram link open, the Query console link locked), refused a save while its access is read, switched to read & write and saved, then left for the project database, whose tabs and recents follow it.
- `an-external-database-refuses-what-it-cannot-serve-with-sentences`: the drawn Diagram with a layout of its own and the locked Query console, the routes that answer 409, a stale tab, a project file the writer cannot rewrite, and the API's refusals of an unknown database and a bad body.

## How to get to it (user POV)

- The switcher at the top of the Database module's sidebar; the bar at the top of the Data browser; `/modules/database/schemas`, `/overview` and `/data` on the picked database.

## Driving it

```bash
pnpm e2e:run specs/external.spec.ts
```

## Gotchas

- Both journeys run the backend in development, since only a development backend loads the `mongodb-erp` provider and its tables module (`VERIFY_DATABASE_EXTERNAL`, see `e2e/playground/antelope.config.ts`) and lets the access change.
- `POST /verify-database-erp/seed` writes the `erp.customers` collection before the backend restarts: a provider in external mode registers only collections that already exist.
- The playground's `antelope.config.ts` holds its modules in a spread, which the DMS configuration writer refuses to rewrite. A journey points the writer at a scratch project folder with `VERIFY_DATABASE_PROJECT_ROOT` (the DMS builder's `projectRoot`), so the access switch writes a real file and the playground's own is never touched.
- Known findings, each a check named in the journey's `knownFailures`: the Overview names instances on an external database, and the save review names `@default`.
- Not driven: `not_development` (the production backend cannot load the external modules, so the switch is never offered or refused there; `src/test/external-access.test.ts` holds it), the account that can only read, a catalog that does not answer, and the 10,000-row cap, which need an authenticated MongoDB the playground does not run.

## Coverage

| Documented behaviour | Journey and check |
|---|---|
| The switcher lists the project database, then each external one with its engine and the External badge | `an-external-database-is-picked-browsed-edited-and-left` (the console lists erp, the switcher) |
| Overview, Schemas, Diagram and Data browser read it; the Query console is locked; no instances | the same journey (the Data browser, Schemas and the inspector, the Overview) and `an-external-database-refuses-what-it-cannot-serve-with-sentences` (the locked and the drawn pages) |
| Rows edit only when the access is `read-write`; a refusal says so | `an-external-database-is-picked-browsed-edited-and-left` (a save while the access is read, a save while read-write) |
| The bar changes the access in development; turning on asks once, turning off asks nothing | the same journey (the confirmation, the access switch, a save while read-write) |
| An edit on a stale tab is refused | `an-external-database-refuses-what-it-cannot-serve-with-sentences` (a stale tab) |
| A refusal of the routes answers a translation key the dashboard shows as a sentence | `an-external-database-refuses-what-it-cannot-serve-with-sentences` (the connection routes, the routes for an external database, a project file the writer cannot rewrite) |
| The choice is kept per user; tabs and recents belong to each database | `an-external-database-is-picked-browsed-edited-and-left` (back on the project database, tabs and recents follow each database) |
| A large or slow database: capped search, 504, the catalog deadline | Not driven: needs a table of more than 10,000 rows and a database that does not answer; `src/test/external-bounds.test.ts` holds them |
