---
covers:
  - src/config.ts
  - src/service/schemaLabels.ts
docs:
  - docs/3.configuration.md
  - docs/5.extending.md
---

# Config

The `schemaLabels` option and the built-in patterns that badge schemas.

## Sub-features

- `built-in-patterns-label-schemas-by-the-start-of-their-id`: with no configuration, app, core, global, staging, reviews and production schemas get their label and tone; others get none.
- `an-exact-key-beats-a-pattern-which-beats-a-built-in-label`: the resolution order, and that the first matching `*` key wins.
- `a-label-takes-each-of-the-seven-tones`: each tone, the primary default, and that options are read at start.

## How to get to it (user POV)

- `config` block of the `dms-database` entry; the badge shows on the Overview's schema cards and in the pickers.

## Driving it with dms-control

```bash
dms-control journey "$RUN" config
```

## Gotchas

- `withConfig` restarts the backend with `VERIFY_DATABASE_SCHEMA_LABELS` (`key:Label:tone;...`) and again without it.

## Coverage

| Documented behaviour | Journey and check |
|---|---|
| Resolution order: exact id, first `*` key, built-in | `an-exact-key-beats-a-pattern-which-beats-a-built-in-label` |
| Built-in table of six prefixes with labels and colours | `built-in-patterns-label-schemas-by-the-start-of-their-id` (app, core, global, staging, reviews, production) |
| Not driven: the `application`, `review` and `prod` spellings of the built-in prefixes | Not driven: the playground registers one schema per label; spellings share the pattern |
| `color` takes the seven DMS tones | `a-label-takes-each-of-the-seven-tones` |
| Options are read at start: restart after a change | `a-label-takes-each-of-the-seven-tones` (last step) |
| `driverLabel` | covered by the `overview` feature |
| No settings page: layouts, notes and queries are data in the module's own schema | `access` feature (the schema `dms-database` is listed) |
