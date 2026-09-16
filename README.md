# @antelopejs/dms-database

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

Database administration for AntelopeJS DMS. The module uses the Database interface to provide
health and schema overviews, schema and table inspection, data browsing, a schema diagram, and an
AQL query workspace under `/modules/database`.

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

The module registers its Vue 3 Inertia frontend through `frontend-vue/dms.frontend.ts`. The adapter
discovers composables and locale files from this directory; Nuxt is not required.

Run `pnpm --dir frontend-vue install` and `pnpm --dir frontend-vue test` for frontend tests. Set
`DMS_FRONTEND_WORKSPACE` to a generated Inertia workspace before running
`pnpm --dir frontend-vue typecheck`.

Run `DMS_SOURCE=/absolute/path/to/dms pnpm test` to test a local DMS runtime with disposable MongoDB
and filesystem storage. Only the test harness loads the runtime; the types come from
`@antelopejs/interface-dms`, so `pnpm typecheck` is unaffected by that path.
