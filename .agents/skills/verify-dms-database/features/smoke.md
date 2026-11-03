---
covers:
  - src/index.ts
  - src/module.ts
docs:
  - docs/1.introduction.md
  - docs/2.installation.md
---

# Smoke

The fixed journey every verdict runs, whatever the diff touches: the introduction's path from the connection check to a row and a query.

## Sub-features

- `smoke`: the owner opens the Overview and reads a healthy connection, finds a table in Schemas, browses its rows in the Data browser and runs a query on it in the Query console.

## How to get to it (user POV)

- Modules › Database, `/modules/database/overview`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" smoke
```
