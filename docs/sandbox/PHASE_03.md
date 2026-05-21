# Phase 3 — TUI sandbox indicator

## Summary

Add a visual sandbox indicator to two places in the TUI:

1. **Manage mode QueuePane** — a padlock glyph on each run row that has `sandboxed: true` in its
   RunMeta.
2. **Drilldown** — a "Sandbox" field in the metadata section showing enabled/disabled.

This phase is purely additive display work. No new business logic.

## Context

After Phase 2, `RunMeta.sandboxed` is a reliable `boolean | undefined` field. The TUI reads RunMeta
via `useQueueState()` (polling every 2 seconds) or directly in the Drilldown component.

### QueuePane run row (Manage mode)

The QueuePane in `src/tui/Manage.tsx` renders one row per run with a `<StateChip>`, the run ID
slug, and plan folder name. There is space at the right of the row for a small status indicator.
Add a glyph `⊡` (U+22A1, "squared dot") when `run.sandboxed === true`, in a muted color from the
theme (e.g. `theme.colors.fg3` or similar dim color). Show nothing when `sandboxed` is falsy —
keep the row uncluttered.

The glyph should be right-aligned within the row, similar to how cost is shown in PhasesPane.

### Drilldown metadata section

`src/tui/Drilldown.tsx` renders a metadata section with fields like "Run ID", "Plan folder",
"Branch", "Status", "Cost". Add a "Sandbox" field after "Status":

- `sandboxed === true` → `enabled` (in green, using the `complete` state color from the theme)
- `sandboxed === false` or `undefined` → `disabled` (in the dim fg3 color)

## Files expected to change

| File | Change |
|------|--------|
| `src/tui/Manage.tsx` | Add padlock glyph to QueuePane run rows for sandboxed runs |
| `src/tui/Drilldown.tsx` | Add "Sandbox" metadata field |

## Reading the existing TUI code

Before editing, read both files fully. Pay attention to:
- How `RunMeta` is accessed in the component props
- The existing color tokens (`theme.colors`) in `src/tui/theme.ts`
- How other fields are laid out in the QueuePane row and Drilldown metadata section
- Ink layout primitives in use (`<Box>`, `<Text>`, flexDirection, etc.)
