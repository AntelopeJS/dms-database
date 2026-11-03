---
covers:
  - src/db/**
  - src/routes/query.ts
  - frontend-vue/app/components/QueryLibrary.vue
  - frontend-vue/app/build/composables/useQueryStore.ts
  - frontend-vue/app/build/query/runs.ts
docs:
  - docs/4.usage/5.query-console.md
  - docs/6.faq.md
  - README.md
---

# Library

The history, saved and team queries beside the console.

## Sub-features

- `history-keeps-your-last-500-runs-newest-first`: the 500 cap, order, paging and the sentence that states it.
- `history-records-failures-and-writes-with-their-status`: status, error, mutation and row count, and how the library words them.
- `history-is-searchable-and-clearing-it-keeps-the-saved-queries`: search, the Clear history question, Cancel and Confirm.
- `a-saved-query-needs-a-name-and-can-be-edited-and-deleted`: Ctrl+S, the name rule, description, restore, edit, delete.
- `a-shared-query-reaches-the-team-and-only-its-author-changes-it`: Team tab, 404 for a teammate's edit or delete.
- `history-belongs-to-its-user-and-a-link-restores-a-run`: per-user history and the `?history=` link.
- `the-library-survives-a-backend-restart`: persistence.

## How to get to it (user POV)

- Query console, the library on the left: History, Saved, Team.

## Driving it with dms-control

```bash
dms-control journey "$RUN" library
```

## Gotchas

- The 500-run journey makes 503 requests, so it takes about a minute.
- A teammate is a second owner (`member(ctx, name, [], true)`): the routes are owner-only, so a plain member sees nothing.

## Coverage

| Documented behaviour | Journey and check |
|---|---|
| History: your last 500 runs | `history-keeps-your-last-500-runs-newest-first` |
| History: grouped by day, searchable | `history-records-failures-and-writes-with-their-status` (Today), `history-is-searchable-and-clearing-it-keeps-the-saved-queries` (search). Yesterday group: Not driven, a run cannot be aged |
| Clear history empties it | `history-is-searchable-and-clearing-it-keeps-the-saved-queries` |
| Saved: the queries you saved (Ctrl S), with a name and a description | `a-saved-query-needs-a-name-and-can-be-edited-and-deleted` |
| Team: shared queries; teammates run them; only the author edits or deletes (README, FAQ) | `a-shared-query-reaches-the-team-and-only-its-author-changes-it` |
| FAQ: only you see your saved queries unless you tick Share with team | same journey (the private query is not in Team) |
| History records failures; old rows without status read as ok (design Q26) | failures: `history-records-failures-and-writes-with-their-status`; old rows: Not driven, the journeys cannot write a legacy row into the module's table |
| Persistence in the module's own schema | `the-library-survives-a-backend-restart` |
