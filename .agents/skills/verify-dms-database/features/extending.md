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

- `a-registered-schema-shows-its-tables-columns-indexes-relations-and-modifiers`: introspection of declared tables, instances and modifiers.
- `deep-links-open-the-documented-pages-on-the-table`: the four links of the Link to the console table, with `instance=<name>` and `instance=all`.
- `without-the-automation-module-the-trigger-registration-is-a-silent-no-op`: a quiet start without `@antelopejs/dms-automation`.

## How to get to it (user POV)

- A module calls `RegisterSchema` and declares tables; a notification or row action links to a console page.

## Driving it with dms-control

```bash
dms-control journey "$RUN" extending
```

## Gotchas

- The Schemas, Diagram, Data and Query features drive the pages behind the links in depth; this feature checks that each link lands on the right table.

## Coverage

| Documented behaviour | Journey and check |
|---|---|
| Registered schemas appear with tables, columns, indexes, relations | first journey |
| Each instance is listed in the pickers | first journey (instances API), Data feature (pickers) |
| Hashed, localized, encrypted columns carry a modifier badge | first journey (API), Schemas feature (badge) |
| Deep links with `instance=<name>` and `instance=all` | second journey |
| Without the automation module the registration is a silent no-op | third journey |
| Table watch trigger: config, output, one node, reconnect once | Not driven: it needs `@antelopejs/dms-automation` and a change feed; `dms-control` starts a standalone mongod (draft `dms-control-mongo-replica-set`) |
| On a standalone MongoDB activation fails with "$changeStream is only supported on replica sets" | Not driven, same reason |
| Supported extension boundary: root barrel exports exist, no subclassing contract | Not driven: a statement of non-support has no observable effect |
| Frontend components `DmsDatabase*` are for the module's own pages | The five pages render in their features |
| FAQ: a missing table needs `RegisterSchema` and `@RegisterTable` | `schemas` feature lists registered tables |
