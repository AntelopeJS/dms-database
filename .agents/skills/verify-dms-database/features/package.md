---
covers:
  - package.json
  - skills/**
  - frontend-vue/package.json
  - frontend-vue/tsconfig.json
  - frontend-vue/dms.frontend.ts
  - frontend-vue/dms.frontend.build.ts
  - frontend-vue/build/**
  - frontend-vue/i18n/**
  - src/frontend-module.ts
  - src/i18n/**
docs:
  - README.md
  - docs/2.installation.md
  - docs/5.extending.md
---

# Package

What a project installs from the registry: the module with its build, its Vue dashboard layer with both locales and its agent skill, and the ranges the README compatibility table names.

## Sub-features

No browser drives these: they are mocha tests of the backend suite, `src/test/package.test.ts`, not journeys.

- `the tarball holds what its manifest names`: the packed tarball holds every path the manifest points at, the layer with its components and both locales, the skill and its cases, and holds no test build, no build info and no docs.
- `both locales hold the same texts, none empty`: the English and French locale files hold the same keys and no empty text.
- `the README compatibility table names each interface range and the layer pins one renderer minor`: each `@antelopejs/interface-*` dependency appears in the README compatibility table with the same range, and the layer pins one renderer minor.

## How to get to it (user POV)

- `ajs project modules add @antelopejs/dms-database` installs the tarball; nothing is driven in a browser.

## Driving it

```bash
pnpm run build
pnpm exec ajs module test . -f dist/test/package.test.js
```

## Gotchas

- The tests run `npm pack --ignore-scripts` on the checkout and read its files, so they need the build of `pnpm run build` and no DMS state.
- The registered component names (`DmsDatabase` prefix) are driven by the page features: a rename would make a page fail to render.
