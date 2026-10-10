# @antelopejs/dms-database

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

Database administration for AntelopeJS DMS. The module uses the Database interface to give the
platform owner, under `/modules/database`:

- **Overview**: connection health, one card per registered schema, the largest tables and the
  latest queries.
- **Schemas**: every registered table, with a filter bar (schema, instance, table or column name,
  structure flags) kept in the URL, and an inspector on the right listing its columns, indexes,
  relations (both ways) and a sample row.
- **Diagram**: the tables and relations of a schema. The layout saves itself and is shared by the
  team; auto layout is previewed before it is kept.
- **Data browser**: the rows of any table, in any instance or across all of them (read only).
  Edits are staged, reviewed and written only when saved, and a save can be undone for a few
  seconds.

Links between the pages carry the instance in an `instance` query key: absent for the default
instance, `all` for every instance, otherwise the instance's name.
- **Query console**: AQL with completion of the workspace's schemas, a library of past, saved and
  shared queries, and a dry run before any query that changes data.

The module requires `@antelopejs/dms` 0.6 or later and `@antelopejs/dms-frontend` 0.5.

## Installation

Add the module to a project that already uses `@antelopejs/dms` and a Database implementation:

```bash
ajs project modules add @antelopejs/dms-database
```

## Configuration

Configuration is optional. `driverLabel` supplies the database name shown in the health overview;
the Database interface cannot discover it. `schemaLabels` overrides labels for exact schema IDs or
glob patterns containing `*`.

```typescript
config: {
  driverLabel: "MongoDB 8.0",
  schemaLabels: {
    "app-*": { label: "Application", color: "info" },
  },
}
```

## Development

```bash
pnpm install
pnpm build
pnpm test
```

The module registers its Vue 3 frontend through `frontend-vue/dms.frontend.ts`, under the
`DmsDatabase` component prefix: `app/components/DataBrowser.vue` is the `DmsDatabaseDataBrowser`
the backend page names. The pages themselves are declared in `src/pages`, as DMS blocks plus the
module's own components. Everything under `frontend-vue/app/build` is private to the layer and
imported by path.

The playground (`pnpm dev`, then `pnpm frontend:dev`) registers a `demo` schema
and a `shop` schema with `eu` and `us` instances, seeded on first start.

`docs/redesign-v2-grill.md` records the decisions behind the v2 redesign.

Run `pnpm --dir frontend-vue install` and `pnpm --dir frontend-vue test` for frontend tests. Set
`DMS_FRONTEND_WORKSPACE` to a generated Inertia workspace before running
`pnpm --dir frontend-vue typecheck`.

Run `DMS_SOURCE=/absolute/path/to/dms pnpm test` to test a local DMS runtime with disposable MongoDB
and filesystem storage. Only the test harness loads the runtime; the types come from
`@antelopejs/interface-dms`, so `pnpm typecheck` is unaffected by that path.
