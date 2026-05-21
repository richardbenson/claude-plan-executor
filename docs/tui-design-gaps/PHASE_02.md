# Phase 2 — Header live indicator + ActivityFeed label

## Summary

Three small visual fixes to `Watch` mode:

1. **Header**: Add a green `●` live indicator before the status text and an elapsed-time
   display (`today · active 2h 14m`) on the right side of the header.  Update the status
   text to reflect limit-paused and user-paused states rather than the generic "queue running".

2. **Header limit-paused text**: When the queue is limit-paused, the header should read
   `queue paused · waiting on 5h limit window`.

3. **ActivityFeed**: Prepend a `LIVE ACTIVITY` label before the `● streaming session…` line
   so the feed area matches the design mock (§3 of DESIGN.md).

## Context

`App.tsx` currently:
- Derives `sessionActive` from activity events (becomes `true` on `phase`, `false` on `ok`/`error`)
- Sets `queueStatusText` as `'queue running'` or `'queue idle'`
- Does NOT call `useQueueState()` — but Watch and Manage each call it themselves

`Header.tsx` currently:
- Has an `elapsed?: number` prop that is defined but never passed from App.tsx
- Shows `statusText` as plain text with no colour indicator
- Shows datetime on the right with no elapsed time

`ActivityFeed.tsx` currently:
- First rendered element is `<Text> ● streaming session…</Text>` — no "LIVE ACTIVITY" label

## Approach

- Import `useQueueState` in `App.tsx` to get `isPaused`, `isLimitPaused` for the status text.
- Track `sessionStartedAt: Date | null` in `App.tsx` — set it to `event.timestamp` on the
  first `phase` event of the TUI session; never reset (tracks "active since").
- Replace the `elapsed?: number` prop with `startedAt?: Date`; `Header` computes the
  formatted string itself using a per-minute tick (matching the existing interval pattern).
- In `ActivityFeed.tsx`, add a `LIVE ACTIVITY` label as the first element before the
  `● streaming session…` line.

## Files expected to change

| File | Change |
|---|---|
| `src/tui/App.tsx` | Import `useQueueState`; track `sessionStartedAt`; derive rich status text |
| `src/tui/components/Header.tsx` | Replace `elapsed` prop with `startedAt`; add `●` dot; add elapsed time display |
| `src/tui/components/ActivityFeed.tsx` | Add `LIVE ACTIVITY` label line |

## Edge cases

- `sessionStartedAt` is `null` when the TUI starts with no active run — `Header` must
  render gracefully with no elapsed time shown.
- The `● ` live indicator should only appear when `sessionActive` is true; otherwise the
  header shows plain status text with no dot.
- The elapsed time format: `active Xh Ym` when ≥ 60 min; `active Xm` when < 60 min.
