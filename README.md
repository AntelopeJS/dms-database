<div align="center">

# @antelopejs/dms-database

<a href="https://www.npmjs.com/package/@antelopejs/dms-database"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/dms-database?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/dms-database?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a>
<a href="https://dms.antelopejs.com/docs/modules/database"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

The database console of the AntelopeJS DMS: schemas, diagrams, rows and queries.

</div>

![The Database diagram: the tables and relations of a shop schema](./docs/images/diagram-shop.png)

## What it does

- Checks the connection and its latency, with one card per registered schema and the largest tables.
- Lists every table the loaded modules register, with its columns, indexes, relations and a sample row.
- Draws the tables and relations of a schema, with a layout and notes shared by the whole team.
- Browses and fixes rows in any instance: edits are staged, reviewed, saved, and can be undone for ten seconds.
- Runs AQL queries with completion and history, and a dry run before any query that writes.

A saved row shows in place; the page is read again when a save may move rows (a sorted or filtered field, or a search).

The pages and the module's API answer to the platform owner only.

## Install

Run the AntelopeJS CLI from the root of a project that already loads `@antelopejs/dms`:

```bash
ajs project modules add @antelopejs/dms-database
```

## Quick start

The module works without configuration. To show the database name on the Overview and label your schemas, add a `config` block:

```ts fragment
// antelope.config.ts
"dms-database": {
  source: { type: "package", package: "@antelopejs/dms-database", version: ">=0.2.0 <1.0.0" },
  config: {
    driverLabel: "MongoDB 8.0",
    schemaLabels: {
      "app-*": { label: "Application", color: "info" },
    },
  },
},
```

Restart the backend, then the frontend, sign in as the platform owner and open **Modules → Database** (`/modules/database/overview`).

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                                     | Supported                                                                 | Tested with                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `@antelopejs/interface-api`                 | `file:.campaign/tgz/antelopejs-interface-api-f206be7.tgz`                 | `file:.campaign/tgz/antelopejs-interface-api-f206be7.tgz`                 |
| `@antelopejs/interface-api-util`            | `file:.campaign/tgz/antelopejs-interface-api-util-cc740f8.tgz`            | `file:.campaign/tgz/antelopejs-interface-api-util-cc740f8.tgz`            |
| `@antelopejs/interface-core`                | `>=0.2.4 <1.0.0`                                                          | `0.2.4`                                                                   |
| `@antelopejs/interface-database`            | `file:.campaign/tgz/antelopejs-interface-database-02e0360.tgz`            | `file:.campaign/tgz/antelopejs-interface-database-02e0360.tgz`            |
| `@antelopejs/interface-database-decorators` | `file:.campaign/tgz/antelopejs-interface-database-decorators-e79a62b.tgz` | `file:.campaign/tgz/antelopejs-interface-database-decorators-e79a62b.tgz` |
| `@antelopejs/interface-dms`                 | `file:.campaign/tgz/antelopejs-interface-dms-e0787e6.tgz`                 | `file:.campaign/tgz/antelopejs-interface-dms-e0787e6.tgz`                 |
| `@antelopejs/interface-dms-automation`      | `file:.campaign/tgz/antelopejs-interface-dms-automation-b4bc5d2.tgz`      | `file:.campaign/tgz/antelopejs-interface-dms-automation-b4bc5d2.tgz`      |

<!-- antelopejs-docs-compat:end -->

The module also needs a DMS backend in a release that implements the `@antelopejs/interface-dms` range above, and the `@antelopejs/dms-frontend` renderer in the range its frontend module declares in `engines["@antelopejs/dms-frontend"]` of `frontend-vue/package.json`; the `ajs dms` CLI refuses to build it with a renderer outside that range, and an `@antelopejs/interface-database` implementation, such as `@antelopejs/mongodb`.

## Documentation

- [Introduction](https://dms.antelopejs.com/docs/modules/database/introduction)
- [Installation](https://dms.antelopejs.com/docs/modules/database/installation)
- [Configuration](https://dms.antelopejs.com/docs/modules/database/configuration)
- [Usage](https://dms.antelopejs.com/docs/modules/database/usage/overview)
- [Extending](https://dms.antelopejs.com/docs/modules/database/extending)
- [FAQ](https://dms.antelopejs.com/docs/modules/database/faq)

The canonical guide lives in [`docs/`](./docs), including the [supported extension boundary](./docs/5.extending.md#supported-extension-boundary). There is no separate DMS Database interface package. The package also ships the `dms-database` Claude Code skill in [`skills/`](./skills), declared under `antelopeJs.skills`.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. The playground registers a `demo` schema and a `shop` schema with `eu` and `us` instances, seeded on first start.

One root install includes the backend and shipped Vue module, retaining their separate lockfiles. The playground remains independent: run `pnpm --dir playground install --ignore-workspace --frozen-lockfile` before starting it. Use the root scripts below rather than recursive scripts: frontend `build` and `typecheck` need the playground or a generated Inertia workspace, and root lint already checks the Vue module.

```bash
pnpm install
pnpm dev            # playground backend
pnpm frontend:dev   # dashboard, in a second terminal
pnpm lint
pnpm typecheck
pnpm test
```

<details>
<summary>Repository notes</summary>

- The module registers its Vue 3 frontend through `frontend-vue/dms.frontend.ts`, under the `DmsDatabase` component prefix: `app/components/DataBrowser.vue` is the `DmsDatabaseDataBrowser` the backend page names. The pages are declared in `src/pages`, as DMS blocks plus the module's own components. Everything under `frontend-vue/app/build` is private to the layer and imported by path.
- Run `pnpm test:layer` for the frontend tests and `pnpm test:frontend` to build and typecheck a generated Inertia app. Set `DMS_FRONTEND_WORKSPACE` to a generated Inertia workspace before running `pnpm --dir frontend-vue typecheck`.
- `DMS_SOURCE=/absolute/path/to/dms pnpm test` tests against a local DMS runtime with disposable MongoDB and filesystem storage. Only the test harness loads that runtime; the types come from `@antelopejs/interface-dms`.
- `docs/design/redesign-v2-grill.md` records the decisions behind the v2 redesign.

</details>

## License

[Apache-2.0](./LICENSE)
