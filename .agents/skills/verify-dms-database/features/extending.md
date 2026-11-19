---
covers:
  - src/automation/**
  - frontend-vue/app/config/shortcuts-registry.ts
  - src/utils/guards.ts
  - src/types/**
  - src/service/introspect.ts
docs:
  - docs/5.extending.md
  - docs/6.faq.md
---

# Extending

What the module picks up from the rest of the project (registered schemas, their modifiers, the automation module) and the deep links other pages use.

## Sub-features

- `deep-links-open-the-documented-pages-on-the-table`: the four links of the Link to the console table, with `instance=<name>` and `instance=all`.
- `without-the-automation-module-the-trigger-registration-is-a-silent-no-op`: a quiet start without `@antelopejs/dms-automation`.

## Integration tests

`pnpm test` runs these in `src/test/extending.journeys.test.ts`, one `it` per id, so `-g <id>` selects one.

- `a-registered-schema-shows-its-tables-columns-indexes-relations-and-modifiers`: introspection of declared tables, instances and modifiers.
- `the-table-watch-hands-a-procedure-each-insert-update-and-delete`: with the automation module loaded, a procedure on a Table watch runs on each write of the default instance and not on a write of another instance.

## How to get to it (user POV)

- A module calls `RegisterSchema` and declares tables; a notification or row action links to a console page.

## Driving it

```bash
pnpm e2e:run specs/extending.spec.ts
```

## Gotchas

- The Schemas, Diagram, Data and Query features drive the pages behind the links in depth; this feature checks that each link lands on the right table.
- The playground runs without `@antelopejs/dms-automation`, and the `pnpm test` harness always loads it, so the silent no-op stays a journey and the table watch runs in the integration test.

## Coverage

| Documented behaviour | Journey and check |
|---|---|
| Registered schemas appear with tables, columns, indexes, relations | `a-registered-schema-shows-its-tables-columns-indexes-relations-and-modifiers` (integration test) |
| Each instance is listed in the pickers | `a-registered-schema-shows-its-tables-columns-indexes-relations-and-modifiers` (integration test, instances API), Data feature (pickers) |
| Hashed, localized, encrypted columns carry a modifier badge | `a-registered-schema-shows-its-tables-columns-indexes-relations-and-modifiers` (integration test, API), Schemas feature (badge) |
| Deep links with `instance=<name>` and `instance=all` | `deep-links-open-the-documented-pages-on-the-table` |
| Without the automation module the registration is a silent no-op | `without-the-automation-module-the-trigger-registration-is-a-silent-no-op` |
| Table watch trigger: config, output (type, old and new rows without the instance tag) | `the-table-watch-hands-a-procedure-each-insert-update-and-delete` (integration test) |
| Table watch trigger: one node, reconnect once | Not driven: the run has one backend, and a journey cannot break its change stream |
| On a standalone MongoDB activation fails with "$changeStream is only supported on replica sets" | Not driven: the run's `mongod` is a replica set |
| On a collection that records no pre-images activation fails with the store's `collMod` sentence | Not driven: the playground's collections are created by the driver, with pre-images; `src/test/table-watch-feed.test.ts` checks it |
| Supported extension boundary: root barrel exports exist, no subclassing contract | Not driven: a statement of non-support has no observable effect |
| Frontend components `DmsDatabase*` are for the module's own pages | The five pages render in their features |
| FAQ: a missing table needs `RegisterSchema` and `@RegisterTable` | `schemas` feature lists registered tables |
