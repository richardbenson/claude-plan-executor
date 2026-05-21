# Phase 5 — Limit window real data + Watch paused polish

## Summary

Fill in the three remaining stubs in Watch mode and improve the paused-state experience:

1. **LimitWindow sparkline / cost data**: Replace the hardcoded `data={[0]}` and "0% used"
   with a real hourly cost sparkline derived from `activityBus`. When limit-paused, show
   "100%" and a full bar; otherwise show hourly cost bucketed across 18 slots (same approach
   as the cost/hour sparkline in `WatchHero`). The API does not expose the token cap so we
   display cost, not token percentage.

2. **WatchPaused (user) improvements**:
   - Show time-since-pause: read the most recent `pause` event from `activityBus.getBuffer()`
     and compute how long ago it was (e.g. `2m ago`).
   - Add `‖ paused` tag to each queued run in the `UpNext` column.

3. **WatchPaused (limit) — "WHILE YOU WAIT" block**:
   Add a brief static hint block below the hero in `LimitPausedFull` that explains
   auto-resume behaviour.

## Context

### LimitWindow in WatchBottomStrip.tsx

```tsx
<Text color={dim}>{'▰▰▰▰▰▱▱▱▱▱▱▱▱▱'}<Text color={dim2}> 0% used</Text></Text>
```
and:
```tsx
<Sparkline data={[0]} width={8} color={dim2} />
```

Both are stubs. Since we can't know the token cap, we track cost-per-hour in the current
rolling window (last 5 hours) and show that as the sparkline. When `isLimitPaused` is true,
the full 14-block bar is shown with no percentage (we know the window is exhausted).

### UpNext in WatchBottomStrip.tsx

When `queueState.isPaused`, append `‖` tags to each queued run entry in `UpNext`.

### WatchPaused user variant

Read the pause event timestamp from `activityBus.getBuffer()`. Compute elapsed:
```ts
const pauseEvent = [...activityBus.getBuffer()].reverse().find(e => e.kind === 'pause');
const pausedAgo = pauseEvent
  ? formatAgo(Date.now() - pauseEvent.timestamp.getTime())
  : null;
```
Where `formatAgo(ms)` returns `"2m ago"`, `"1h 4m ago"`, etc.

Show it in the hero header: `‖ QUEUE PAUSED · by user · {pausedAgo}`.

### WatchPaused limit variant — "WHILE YOU WAIT"

Add after the `WHAT'S WAITING` section:

```
WHILE YOU WAIT
· cpe will auto-resume when the window resets
· the current phase (if any) has already been stopped
· no action required — check back at <resumeTime>
```

## Files expected to change

| File | Change |
|---|---|
| `src/tui/components/WatchBottomStrip.tsx` | Real hourly cost sparkline in LimitWindow; `‖ paused` tags in UpNext |
| `src/tui/components/WatchPaused.tsx` | Time-since-pause in user variant; "WHILE YOU WAIT" in limit variant |

## Edge cases

- The hourly cost sparkline reuses the same `buildHourlySparkline` logic from `WatchHero`.
  Extract it to a shared helper or inline it in `LimitWindow`.
- If no `pause` event is in the buffer, `pausedAgo` is `null` — show the header without the
  `· X ago` suffix.
- The "WHILE YOU WAIT" block should only appear in the limit variant (never in user-paused).
