# @antelopejs/dms-database

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

Database administration for the AntelopeJS DMS. Under **Modules → Database**, the platform owner
checks the connection, inspects every registered schema, draws its diagram, browses and fixes rows,
and runs AQL queries with a dry run before any write.

**Documentation:** [dms.antelopejs.com/docs/modules/database](https://dms.antelopejs.com/docs/modules/database)
(source in [`docs/`](./docs)).

## Installation

```bash
ajs project modules add @antelopejs/dms-database
```

The module requires `@antelopejs/dms` 0.9 (`@antelopejs/interface-dms` 0.7),
`@antelopejs/dms-frontend` 0.6 and a Database implementation. See the
[configuration](https://dms.antelopejs.com/docs/modules/database/configuration) for `driverLabel`
and `schemaLabels`.

The package ships a Claude Code skill, `skills/dms-database`, declared in `antelopeJs.skills`.

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

`docs/design/redesign-v2-grill.md` records the decisions behind the v2 redesign.

Run `pnpm --dir frontend-vue install` and `pnpm --dir frontend-vue test` for frontend tests. Set
`DMS_FRONTEND_WORKSPACE` to a generated Inertia workspace before running
`pnpm --dir frontend-vue typecheck`.

Run `DMS_SOURCE=/absolute/path/to/dms pnpm test` to test a local DMS runtime with disposable MongoDB
and filesystem storage. Only the test harness loads the runtime; the types come from
`@antelopejs/interface-dms`, so `pnpm typecheck` is unaffected by that path.
