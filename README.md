<div align="center">

# `@antelopejs/dms-database`

<a href="https://www.npmjs.com/package/@antelopejs/dms-database"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/dms-database?style=for-the-badge&labelColor=000000&color=000000" data-illustration></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/dms-database?style=for-the-badge&labelColor=000000&color=000000" data-illustration></a>
<a href="https://discord.gg/sjK28QHrA7"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" data-illustration></a>
<a href="https://dms.antelopejs.com/docs/modules/database"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" data-illustration></a>

The database console of the AntelopeJS DMS: schemas, diagrams, rows and queries.

</div>

![The Database diagram: the tables and relations of a shop schema](./docs/images/diagram-shop.png)

## What it does

- Checks the connection and its latency, with one card per registered schema and the largest tables.
- Lists every table the loaded modules register, with its columns, indexes, relations and a sample row.
- Draws the tables and relations of a schema, with a layout and notes shared by the whole team.
- Browses and fixes rows in any instance. Edits are staged and reviewed before a save, and a save can be undone for ten seconds.
- Runs AQL queries with completion and history, and a dry run before any query that writes.

A saved row shows in place. The data browser reads the page again when a save may move rows (a sorted or filtered field, or a search) or when a row it saved is gone.

Only the platform owner can open the pages or call the module's API.

## Install

Run the AntelopeJS CLI from the root of a project that already loads `@antelopejs/dms`:

```bash
ajs project modules add @antelopejs/dms-database
```

## Quick start

The module works without configuration. To show the database name on the Overview and label your schemas, add a `config` block to the entry that the command added:

```ts fragment
// antelope.config.ts
"@antelopejs/dms-database": {
  source: { type: "package", package: "@antelopejs/dms-database", version: ">=0.3.1 <1.0.0" },
  config: {
    driverLabel: "MongoDB",
    schemaLabels: {
      "app-*": { label: "Application", color: "info" },
    },
  },
},
```

Restart the backend, then the frontend. Sign in as the platform owner and open **Database** in the **Modules** catalog, or go to `/modules/database/overview`.

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                                     | Supported                                                                 | Tested with                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `@antelopejs/interface-api`                 | `file:.campaign/tgz/antelopejs-interface-api-f2a99b5.tgz`                 | `file:.campaign/tgz/antelopejs-interface-api-f2a99b5.tgz`                 |
| `@antelopejs/interface-api-util`            | `file:.campaign/tgz/antelopejs-interface-api-util-639f38b.tgz`            | `file:.campaign/tgz/antelopejs-interface-api-util-639f38b.tgz`            |
| `@antelopejs/interface-core`                | `file:.campaign/tgz/antelopejs-interface-core-f7df541.tgz`                | `file:.campaign/tgz/antelopejs-interface-core-f7df541.tgz`                |
| `@antelopejs/interface-database`            | `file:.campaign/tgz/antelopejs-interface-database-e533a2f.tgz`            | `file:.campaign/tgz/antelopejs-interface-database-e533a2f.tgz`            |
| `@antelopejs/interface-database-decorators` | `file:.campaign/tgz/antelopejs-interface-database-decorators-e79a62b.tgz` | `file:.campaign/tgz/antelopejs-interface-database-decorators-e79a62b.tgz` |
| `@antelopejs/interface-dms`                 | `file:.campaign/tgz/antelopejs-interface-dms-e0787e6.tgz`                 | `file:.campaign/tgz/antelopejs-interface-dms-e0787e6.tgz`                 |
| `@antelopejs/interface-dms-automation`      | `file:.campaign/tgz/antelopejs-interface-dms-automation-b4bc5d2.tgz`      | `file:.campaign/tgz/antelopejs-interface-dms-automation-b4bc5d2.tgz`      |

<!-- antelopejs-docs-compat:end -->

The module also needs three things the table does not list:

- A DMS backend in a release that implements the `@antelopejs/interface-dms` range above.
- The `@antelopejs/dms-frontend` renderer in the range that `engines["@antelopejs/dms-frontend"]` of `frontend-vue/package.json` declares. The `ajs dms` CLI refuses to build the module with a renderer outside that range.
- An `@antelopejs/interface-database` implementation, such as `@antelopejs/mongodb`.

## Documentation

- [Introduction](https://dms.antelopejs.com/docs/modules/database/introduction)
- [Installation](https://dms.antelopejs.com/docs/modules/database/installation)
- [Configuration](https://dms.antelopejs.com/docs/modules/database/configuration)
- [Usage](https://dms.antelopejs.com/docs/modules/database/usage/overview)
- [Extending](https://dms.antelopejs.com/docs/modules/database/extending)
- [FAQ](https://dms.antelopejs.com/docs/modules/database/faq)

The canonical guide lives in [`docs/`](./docs), including the [supported extension boundary](./docs/5.extending.md#supported-extension-boundary). There is no separate DMS Database interface package. The package also ships the `dms-database` Claude Code skill in [`skills/`](./skills), declared under `antelopeJs.skills`.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. The playground registers a `demo` schema and a `shop` schema with `eu` and `us` instances, and seeds both on first start.

One root install covers the backend and the shipped Vue module, and each keeps its own lockfile. The playground is not a workspace package. Run `pnpm --dir playground install --ignore-workspace --frozen-lockfile` before you start it. Use the root scripts below, not recursive scripts. The frontend `build` and `typecheck` scripts need the playground or a generated Inertia workspace, and the root `lint` already checks the Vue module.

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

- The module registers its Vue frontend through `frontend-vue/dms.frontend.ts`, under the `DmsDatabase` component prefix. For example, `app/components/DataBrowser.vue` is the `DmsDatabaseDataBrowser` component that the backend page names. `src/pages` declares the pages as DMS blocks plus the module's own components. Everything under `frontend-vue/app/build` is private to the layer and imported by path.
- Run `pnpm test:layer` for the frontend tests and `pnpm test:frontend` to build and typecheck a generated Inertia app. Set `DMS_FRONTEND_WORKSPACE` to a generated Inertia workspace before running `pnpm --dir frontend-vue typecheck`.
- `DMS_SOURCE=/absolute/path/to/dms pnpm test` tests against a local DMS runtime with disposable MongoDB and filesystem storage. Only the test harness loads that runtime. The types come from `@antelopejs/interface-dms`.
- [`docs/design/redesign-v2-grill.md`](./docs/design/redesign-v2-grill.md) records the decisions behind the v2 redesign.

</details>

## License

[Apache-2.0](./LICENSE)
