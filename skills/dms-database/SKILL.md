---
name: dms-database
description: Uses the @antelopejs/dms-database console of the AntelopeJS DMS (owner-only pages under /modules/database to inspect schemas, draw diagrams, browse and edit rows, and run AQL). Use when installing or configuring dms-database (driverLabel, schemaLabels), deep-linking to its pages, wiring its "database.table-watch" automation trigger, or explaining why a table is missing from it.
icon: i-lucide-database
category: data
tags: [database, schemas, aql, data-browser, automation]
---

# dms-database

A read-mostly database console for the platform owner. It has no API for other modules: it introspects every schema registered through `@antelopejs/interface-database-decorators`, so a table appears once its module calls `RegisterSchema(<id>)` and declares `@RegisterTable(<table>, <id>)`. User docs: https://dms.antelopejs.com/docs/modules/database (source: `docs/` of this package).

## When to reach for it

- A user wants to look at, fix or query raw rows: point them to the console instead of writing a throwaway admin page.
- A procedure must react to row changes: use the `database.table-watch` trigger (`schema`, `table`, optional `eventTypes`), loaded only with `@antelopejs/dms-automation`.
- Never build a business screen on it: saved edits bypass every module's logic. Build a DMS page for that.

## Config (`antelope.config.ts`, all optional)

- Version 0.2+ needs `@antelopejs/dms` 0.9 (`interface-dms` 0.7) and `@antelopejs/dms-frontend` 0.6; 0.1 is the DMS 0.8 line.

- `driverLabel: "MongoDB 8.0"`: the database name on the Overview (the interface cannot discover it).
- `schemaLabels: { "<schemaId or glob*>": { label, color?: Tone } }`: badges; built-in patterns cover `app*`, `core*`, `global*`, `staging*`, `review*`, `prod*`.

## Deep links

`/modules/database/schemas?record=<schema>::<table>`, `/modules/database/{diagram,data,query}?schema=<schema>&table=<table>`, plus `instance=<name>` or `instance=all`.

## Gotchas

- Owner-only: pages and `/api/database/*` routes answer the platform owner alone.
- The data browser is read-only on **All instances**; a saved edit can be undone for 10 seconds only.
- Write queries in the console always run a dry run and need the table name typed to confirm.
- `table-watch` needs a change feed: MongoDB must run as a replica set.
