# Phase 4 — CommandBar + Manage paused banner

## Summary

Three targeted additions to Manage mode:

1. **CommandBar**: Show `q quit` in the keybind bar. Make the QUEUE row label highlighted
   (cyan) when the queue pane is focused, and RUN row highlighted when executing pane is
   focused, so the active keybind context is visually obvious. The `focusedPane` prop is
   already passed but currently ignored.

2. **Manage paused banner**: When `qs.isPaused` is true, render a full-width yellow banner
   row between the header and the triptych. This matches design §5.6.

3. **ExecutingPane paused message**: When the queue is paused, show
   `‖ this phase will finish · queue won't advance` below the session info line.

## Context

### CommandBar

Current render:
```tsx
<Box flexDirection="column">
  <Text>
    QUEUE  ↑↓ select  ⌥↑↓ reorder  ↵ phases  {pauseLabel}  r remove  a add plan
  </Text>
  <Text>
    RUN    R retry phase  S skip phase  K kill session  e $EDITOR  l log  : palette{...}
  </Text>
</Box>
```

The `focusedPane` prop is accepted but the bar renders identically regardless of focus.
Design shows the active category label in a bright colour and `q quit` at the end of the
RUN row.

### Manage paused banner (§5.6)

Design:
```
‖‖ QUEUE PAUSED · currently-executing phase finishes, then waits · press p to resume
```
Rendered as a full-width yellow text bar (one row) between the header (in App.tsx) and
the triptych. The Manage component already receives `qs.isPaused` — add a conditional row.

Note: Ink does not support background RGBA tints. Use `color={yellow}` with `dimColor` on
a plain `<Text>` spanning the full width.

### ExecutingPane paused message

`ExecutingPane` receives `runMeta`, `activePhase`, `events`, `focused`.
It does NOT currently receive an `isPaused` prop. One clean approach: add `isPaused?: boolean`
to `ExecutingPane`'s props and render the message when true.

## Files expected to change

| File | Change |
|---|---|
| `src/tui/components/CommandBar.tsx` | Use `focusedPane` to highlight active row label; add `q quit` |
| `src/tui/Manage.tsx` | Render paused banner; pass `isPaused` to `ExecutingPane` |
| `src/tui/components/ExecutingPane.tsx` | Accept and render `isPaused` message |

## Edge cases

- The paused banner should only appear in Manage mode (it lives in `Manage.tsx`, not in
  `App.tsx`, so it is never shown in Watch mode).
- The banner must not push the triptych off screen — it uses one row from the available
  height. The current `height={rows - 2}` on the Manage container may need to become
  `height={rows - (qs.isPaused ? 3 : 2)}` to compensate.
- `q quit` in the command bar is informational only — the actual handler remains in App.tsx.
