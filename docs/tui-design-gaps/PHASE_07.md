# Phase 7 — Responsive sizing (80×24 compact layout)

## Summary

Add a compact layout mode for terminals narrower than 100 columns or shorter than 30 rows,
as specified in DESIGN.md §7.1. The compact layout shows one pane at a time; the user presses
`Tab` to swap between them.

### Watch compact (80×24)
- No bottom strip (UP NEXT / LIMIT WINDOW / TODAY omitted)
- No hero box — the hero text collapses to a 3-line summary at the top
- Activity feed fills the remaining rows
- Header drops the datetime and elapsed time; keeps `▮ cpe · MODE · statusText`
- Footer collapses to a single keybinds line

### Manage compact (80×24)
- Single pane visible at a time (queue OR phases OR executing)
- `Tab` cycles between panes
- Status line collapses to one row (no disk size)
- Command bar collapses to one row

## Context

`App.tsx` already reads `{ columns, rows }` from `useStdoutDimensions()` and passes them
to both `Watch` and `Manage`. The compact threshold is:

```ts
const compact = columns < 100 || rows < 30;
```

Both `Watch.tsx` and `Manage.tsx` accept `columns` and `rows` props — add `compact` as a
third prop or derive it from the existing `columns`/`rows` inside each component.

The simplest implementation avoids new files: add a `compact` branch inside each existing
component using conditional rendering. No new component files are required.

## Files expected to change

| File | Change |
|---|---|
| `src/tui/App.tsx` | Derive `compact` and pass to children (or rely on columns/rows already passed) |
| `src/tui/Watch.tsx` | Add compact layout branch |
| `src/tui/Manage.tsx` | Add compact layout branch |
| `src/tui/components/Header.tsx` | Accept `compact` prop; drop datetime + elapsed in compact mode |

## Design constraints from §7.1

- Single pane at a time; `Tab` to swap
- No dashboard cards; metrics collapse to two short lines inside the active pane
- Header drops version + datetime, keeps `▮ cpe` + active run identity
- Footer collapses to one row of keybinds

## Edge cases

- The compact branch must handle all the same state cases (paused, limit-paused, idle,
  executing) but with abbreviated rendering.
- `Drilldown` is full-screen by nature — it does not need a compact variant; it will appear
  oversized on a tiny terminal, which is acceptable.
- `QueueWizard`, `CommandPalette`, and `KillConfirmModal` are modals — they keep their
  current sizing (already width-constrained). In compact mode they may overflow; this is
  acceptable for this phase.
