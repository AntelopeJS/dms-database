## Verify: PASS+NOTES

**Head** `36ecc68` · **Skill** `verify-dms-database` @ `cbd9bc6` (not trusted yet) · **Verifier** claude-opus-5-5, the thread that wrote the change

### One-way doors
None: The diff changes two locale strings; no stored data, API or contract changes.

### Touched features
- `package` (diff: `frontend-vue/i18n/locales/database-en-GB.json`, `frontend-vue/i18n/locales/database-fr-FR.json`)
- smoke: onboard, open the Overview, find a registered schema's table in Schemas, read its rows in the Data browser, run a query on it

### Journeys
| Feature | Entry point | Result | Evidence |
|---|---|---|---|
| smoke | `smoke`: /modules/database/overview, /schemas, /data, /query | pass: the owner reads a healthy connection on the Overview, finds shop.products in Schemas, reads its six rows in the Data browser and runs a query on it in the Query console | [smoke/smoke](https://github.com/AntelopeJS/dms-database/tree/verify-evidence/pr-130/36ecc68c5df4221ff84a9a3656663622a7b676c6/smoke/smoke) |
| package | `the-tarball-holds-what-its-manifest-names`: npm pack of the module | pass: the package tarball holds the build, the dashboard layer with both locales and the agent skill, every path the manifest points at, without test build or build info and without the docs | [package/the-tarball-holds-what-its-manifest-names](https://github.com/AntelopeJS/dms-database/tree/verify-evidence/pr-130/36ecc68c5df4221ff84a9a3656663622a7b676c6/package/the-tarball-holds-what-its-manifest-names) |
| package | `both-locales-hold-the-same-texts`: frontend-vue/i18n/locales/database-en-GB.json and database-fr-FR.json | pass: the English and French locale files hold exactly the same keys, none empty, so every string exists in both languages | [package/both-locales-hold-the-same-texts](https://github.com/AntelopeJS/dms-database/tree/verify-evidence/pr-130/36ecc68c5df4221ff84a9a3656663622a7b676c6/package/both-locales-hold-the-same-texts) |
| package | `ranges-match-the-compatibility-table`: README.md, package.json, frontend-vue/package.json | pass: the README compatibility table lists the interface ranges the module depends on, the dashboard layer pins one renderer minor, and the README names the same renderer cap as the layer's engines | [package/ranges-match-the-compatibility-table](https://github.com/AntelopeJS/dms-database/tree/verify-evidence/pr-130/36ecc68c5df4221ff84a9a3656663622a7b676c6/package/ranges-match-the-compatibility-table) |

### Formal checks
- None ran.

### Docs
- `README.md`: matches. Does not describe the Schemas subtitle.
- `docs/2.installation.md`: matches. Unaffected by a locale string.
- `docs/5.extending.md`: matches. Unaffected by a locale string.
- `docs/4.usage/2.schemas.md`: matches. Already says rows are counted in the picked instance; the en-GB subtitle now uses the same wording.

### Not verified
- The fr-FR subtitle was not rendered in the browser; scripts/check-sources.mts in pnpm lint resolves its key.

### Attention
- Nothing.

Evidence: `verify-evidence` branch, [`pr-130/36ecc68c5df4221ff84a9a3656663622a7b676c6/`](https://github.com/AntelopeJS/dms-database/tree/verify-evidence/pr-130/36ecc68c5df4221ff84a9a3656663622a7b676c6/)
