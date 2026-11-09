# Changelog

## v0.4.3

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.4.2...v0.4.3)

### 🔥 Performance

- **verify:** Stop journeys waiting out timeouts on a passing run ([#136](https://github.com/AntelopeJS/dms-database/pull/136))
- **verify:** Wait on hydration and stillness instead of fixed sleeps ([#137](https://github.com/AntelopeJS/dms-database/pull/137))

### 🩹 Fixes

- **browse:** Accept only declared table names in resolveTable and describeUnknownQueryTarget ([#139](https://github.com/AntelopeJS/dms-database/pull/139))
- **frontend:** Let the JSON cell editor fill the drawer's height ([#146](https://github.com/AntelopeJS/dms-database/pull/146))
- **diagram:** Select and centre the table a cross-schema chip opens ([#143](https://github.com/AntelopeJS/dms-database/pull/143))
- **overview:** Show a dash for the database name when driverLabel is unset ([#147](https://github.com/AntelopeJS/dms-database/pull/147))
- **query:** Show every returned row in the Table view, up to the 1,000-row server cap ([#148](https://github.com/AntelopeJS/dms-database/pull/148))
- **frontend:** Match the web-mode tests under a dot-directory checkout ([#140](https://github.com/AntelopeJS/dms-database/pull/140))
- **schemas:** List a column named constructor in the inspector and the diagram ([#141](https://github.com/AntelopeJS/dms-database/pull/141))
- **diagram:** Sort tables without relations by name, not by a `__` prefix ([#144](https://github.com/AntelopeJS/dms-database/pull/144))
- **query:** Ask for the table name before every write ([#145](https://github.com/AntelopeJS/dms-database/pull/145))

### 📖 Documentation

- **readme:** Open with the AntelopeJS DMS module kit ([#150](https://github.com/AntelopeJS/dms-database/pull/150))

### 📦 Build

- **deps:** Bump @antelopejs/dms to 0.18.2 and drop verify publish ([#149](https://github.com/AntelopeJS/dms-database/pull/149))

### 🤖 CI

- Cache the test modules and run the layer tests beside the formal check ([#135](https://github.com/AntelopeJS/dms-database/pull/135))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.4.2

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.4.1...v0.4.2)

### 🚀 Enhancements

- **playground:** Run the playground on PostgreSQL ([#125](https://github.com/AntelopeJS/dms-database/pull/125))
- **skills:** Add the verify-dms-database verification skill ([#111](https://github.com/AntelopeJS/dms-database/pull/111))

### 🩹 Fixes

- **schemas:** Say rows are counted in the picked instance ([#130](https://github.com/AntelopeJS/dms-database/pull/130))
- **browse:** Order unsorted data browser pages by primary key ([#127](https://github.com/AntelopeJS/dms-database/pull/127))
- **browse:** Type data browser columns from the declared field type ([#128](https://github.com/AntelopeJS/dms-database/pull/128))
- **browse:** List declared columns first, in declaration order ([#129](https://github.com/AntelopeJS/dms-database/pull/129))

### 📦 Build

- **deps:** Bump @antelopejs packages to the 2026-11-06 releases ([#134](https://github.com/AntelopeJS/dms-database/pull/134))

### 🏡 Chore

- Remove the .amp directory ([#124](https://github.com/AntelopeJS/dms-database/pull/124))
- **verify:** Remove seeded runs from the verification skill ([#126](https://github.com/AntelopeJS/dms-database/pull/126))
- **ci:** Remove the weekly mutation caller ([#131](https://github.com/AntelopeJS/dms-database/pull/131))

### ✅ Tests

- **verify:** Map declaredFields.ts to the data and schemas features ([#132](https://github.com/AntelopeJS/dms-database/pull/132))

### 🤖 CI

- Call ci-node.yml@v1 ([#133](https://github.com/AntelopeJS/dms-database/pull/133))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.4.1

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.4.0...v0.4.1)

### 📖 Documentation

- **github:** Send questions and ideas to Discord ([#106](https://github.com/AntelopeJS/dms-database/pull/106))

### 🏡 Chore

- Land the cleanup campaign on main ([#123](https://github.com/AntelopeJS/dms-database/pull/123))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.4.0

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.3.1...v0.4.0)

### 🚀 Enhancements

- **frontend:** Enforce the backend boundary in production builds ([#72](https://github.com/AntelopeJS/dms-database/pull/72))

### 🩹 Fixes

- **amp:** Start the dev frontend in the playground, and ignore its build ([#61](https://github.com/AntelopeJS/dms-database/pull/61))
- **frontend:** Present API errors through the core contract ([#100](https://github.com/AntelopeJS/dms-database/pull/100))

### 💅 Refactors

- Clean up the tests, comments, types and oversize files ([#71](https://github.com/AntelopeJS/dms-database/pull/71))
- **amp:** Narrow the forwarded location header with a JSDoc type guard ([#74](https://github.com/AntelopeJS/dms-database/pull/74))
- Clear the residual ratchet findings ([#76](https://github.com/AntelopeJS/dms-database/pull/76))

### 📖 Documentation

- **changelog:** Upgrade notes of dms-database 0.3.1 ([#60](https://github.com/AntelopeJS/dms-database/pull/60))
- **readme:** Link the DMS in the opening line ([#92](https://github.com/AntelopeJS/dms-database/pull/92))
- **readme:** Use one Discord invite ([#90](https://github.com/AntelopeJS/dms-database/pull/90))

### 📦 Build

- Adopt the AntelopeJS guardrail pack ([#62](https://github.com/AntelopeJS/dms-database/pull/62))
- **deps:** Bump @antelopejs/tooling-configs to 0.2.17 ([#75](https://github.com/AntelopeJS/dms-database/pull/75))

### 🏡 Chore

- Configure Renovate with the shared preset ([#63](https://github.com/AntelopeJS/dms-database/pull/63))

### ✅ Tests

- **skills:** Add eval cases for dms-database skills ([#64](https://github.com/AntelopeJS/dms-database/pull/64))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.3.1

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.3.0...v0.3.1)

### Upgrade notes

- ⚠️ **Minimum versions raised:** requires `@antelopejs/dms` 0.11 (`>=0.11.0`), `@antelopejs/interface-dms` 0.9 (`>=0.9.0`) and the renderer `@antelopejs/dms-frontend` 0.9 (the frontend layer's `engines` is `>=0.9.0 <0.10.0`: the 0.9 loader refuses an older layer, and an older loader refuses this one). `@antelopejs/interface-database` is floored at `>=0.1.11` and `@antelopejs/interface-database-decorators` at `>=0.1.10`, as interface-dms 0.9 asks. Upgrade the backend, interface and renderer together; on DMS 0.10 or earlier, stay on dms-database 0.3.0 ([#59](https://github.com/AntelopeJS/dms-database/pull/59)).
- No API, configuration or data change.

### 📦 Build

- Run on @antelopejs/dms 0.11 and @antelopejs/dms-frontend 0.9 ([#59](https://github.com/AntelopeJS/dms-database/pull/59))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.3.0

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.2.3...v0.3.0)

### 🚀 Enhancements

- **frontend:** The frontend registration as a pure function, declared as dmsFrontend ([#56](https://github.com/AntelopeJS/dms-database/pull/56))
- **diagram:** Readable auto layout for large schemas, fold very tall tables ([#52](https://github.com/AntelopeJS/dms-database/pull/52))

### 🩹 Fixes

- **data:** Stack the table list above the grid on narrow screens ([#53](https://github.com/AntelopeJS/dms-database/pull/53))
- **overview:** No beta notice, no layout shift ([#51](https://github.com/AntelopeJS/dms-database/pull/51))
- **data:** Open the JSON cell editor in the DMS drawer ([#55](https://github.com/AntelopeJS/dms-database/pull/55))

### 📦 Build

- Run on @antelopejs/dms 0.10 and @antelopejs/dms-frontend 0.8 ([#58](https://github.com/AntelopeJS/dms-database/pull/58))

### ✅ Tests

- Render secret for dms 0.10, api 1.4.0 and core 1.17.0 in the test stack ([#57](https://github.com/AntelopeJS/dms-database/pull/57))

### ❤️ Contributors

- Maxime Westhoven ([@mwesto](http://github.com/mwesto))
- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.3

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.2.2...v0.2.3)

### 🩹 Fixes

- **frontend:** Run on @antelopejs/dms-frontend 0.7 ([#54](https://github.com/AntelopeJS/dms-database/pull/54))

### 📖 Documentation

- Clarify learning paths and illustrate real outcomes ([#50](https://github.com/AntelopeJS/dms-database/pull/50))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.2

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.2.1...v0.2.2)

### 🩹 Fixes

- Install database frontend from the root workspace ([#47](https://github.com/AntelopeJS/dms-database/pull/47))
- **catalog:** Remove obsolete database beta status ([#49](https://github.com/AntelopeJS/dms-database/pull/49))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.1

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.2.0...v0.2.1)

### 🔥 Performance

- **frontend:** Show the rows a save writes in place, without reading the page again ([#44](https://github.com/AntelopeJS/dms-database/pull/44))

### 📖 Documentation

- Add user guide and module skill ([#40](https://github.com/AntelopeJS/dms-database/pull/40))
- Clarify Database integration boundaries and table declarations ([#45](https://github.com/AntelopeJS/dms-database/pull/45))
- Make dense guide sections easier to scan ([#46](https://github.com/AntelopeJS/dms-database/pull/46))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.2.0

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.1.2...v0.2.0)

### 🚀 Enhancements

- ⚠️  Migrate to DMS 0.9 and renderer 0.6 ([#43](https://github.com/AntelopeJS/dms-database/pull/43))

#### ⚠️ Breaking Changes

- ⚠️  Migrate to DMS 0.9 and renderer 0.6 ([#43](https://github.com/AntelopeJS/dms-database/pull/43))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.2

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.1.1...v0.1.2)

### 🤖 CI

- Speed up pipeline ([#38](https://github.com/AntelopeJS/dms-database/pull/38))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.1

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.1.0...v0.1.1)

### 🩹 Fixes

- **data:** Build the JSON cell editor from DMS form fields with the required legend ([#36](https://github.com/AntelopeJS/dms-database/pull/36))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.0

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.14...v0.1.0)

### 🚀 Enhancements

- ⚠️  Port dms-database to dms 0.7 and the v2 design ([#35](https://github.com/AntelopeJS/dms-database/pull/35))

#### ⚠️ Breaking Changes

- ⚠️  Port dms-database to dms 0.7 and the v2 design ([#35](https://github.com/AntelopeJS/dms-database/pull/35))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.14

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.13...v0.0.14)

### 🩹 Fixes

- **frontend:** Typecheck the layer in CI and fix the SchemaDiagram modifiers type ([#33](https://github.com/AntelopeJS/dms-database/pull/33))

### 🏡 Chore

- **playground:** Open module source ranges ([#32](https://github.com/AntelopeJS/dms-database/pull/32))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.13

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.12...v0.0.13)

### 🩹 Fixes

- **query:** Fill the panel instead of capping the aside at the viewport ([#31](https://github.com/AntelopeJS/dms-database/pull/31))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.12

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.11...v0.0.12)

### 🚀 Enhancements

- **frontend-vue:** Declare the @antelopejs/dms-frontend releases the layer supports ([#26](https://github.com/AntelopeJS/dms-database/pull/26))

### ❤️ Contributors

- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.0.11

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.10...v0.0.11)

### 🩹 Fixes

- **deps:** Accept compatible 0.x versions of the interface packages ([#23](https://github.com/AntelopeJS/dms-database/pull/23))

### 💅 Refactors

- **pages:** Fill the panel instead of guessing viewport offsets ([#30](https://github.com/AntelopeJS/dms-database/pull/30))

### 🏡 Chore

- **lint:** Check @antelopejs/interface-* ranges ([#29](https://github.com/AntelopeJS/dms-database/pull/29))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.0.10

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.9...v0.0.10)

### 🩹 Fixes

- **db:** Return one page of query history per request and prune only the overflow ([#24](https://github.com/AntelopeJS/dms-database/pull/24))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.9

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.8...v0.0.9)

### 🩹 Fixes

- **query:** Read the color mode from vueuse and bump @vueuse/core to ^14.3.0 ([#21](https://github.com/AntelopeJS/dms-database/pull/21))

### ❤️ Contributors

- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.0.8

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.7...v0.0.8)

### 🩹 Fixes

- **diagram:** Let tables be dragged and draw the relation lines ([#20](https://github.com/AntelopeJS/dms-database/pull/20))

### ❤️ Contributors

- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.0.7

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.6...v0.0.7)

### 🩹 Fixes

- Route playground through public gateway ([#13](https://github.com/AntelopeJS/dms-database/pull/13))

### 💅 Refactors

- **build:** Merge tsconfig.build.json into tsconfig.json ([#16](https://github.com/AntelopeJS/dms-database/pull/16))

### 🏡 Chore

- **playground:** Use dms frontend 0.2.1 ([#12](https://github.com/AntelopeJS/dms-database/pull/12))
- **agents:** Install Node 24 in setup script ([#14](https://github.com/AntelopeJS/dms-database/pull/14))

### 🤖 CI

- **release:** Release next from a dedicated branch and restore requireCommits ([#17](https://github.com/AntelopeJS/dms-database/pull/17))
- **release:** Reference the shared release workflows through v1 ([#18](https://github.com/AntelopeJS/dms-database/pull/18))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.6

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.5...v0.0.6)

### 🩹 Fixes

- **frontend:** Render schema relation labels safely ([#10](https://github.com/AntelopeJS/dms-database/pull/10))

### 🏡 Chore

- Update DMS CLI scripts and dependencies ([#9](https://github.com/AntelopeJS/dms-database/pull/9))
- **orb:** Add playground setup and services ([#11](https://github.com/AntelopeJS/dms-database/pull/11))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.5

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.4...v0.0.5)

### 💅 Refactors

- **frontend:** Import the SDK through #dms/frontend-module ([#8](https://github.com/AntelopeJS/dms-database/pull/8))

### 🏡 Chore

- Require @antelopejs/core 1.7 ([#6](https://github.com/AntelopeJS/dms-database/pull/6))
- Align community files with the organization defaults ([#7](https://github.com/AntelopeJS/dms-database/pull/7))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.4

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.3...v0.0.4)

## v0.0.3

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.2...v0.0.3)

### 💅 Refactors

- **frontend:** Rename the module-local relative-time helper ([#3](https://github.com/AntelopeJS/dms-database/pull/3))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.2

[compare changes](https://github.com/AntelopeJS/dms-database/compare/v0.0.1...v0.0.2)

### 🏡 Chore

- Regenerate lockfiles against the published DMS packages ([#1](https://github.com/AntelopeJS/dms-database/pull/1))
- **release:** Skip the npm auth pre-flight for trusted publishing ([#2](https://github.com/AntelopeJS/dms-database/pull/2))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

