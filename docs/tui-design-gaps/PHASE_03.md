# Phase 3 — StatusLine improvements + Drilldown keybinds

## Summary

Two independent fixes:

1. **StatusLine** (inside `Manage.tsx`): Add ETA, `‖ paused` suffix, and a real disk-size
   reading using `du -sh` instead of the hardcoded `~?MB`.

2. **Drilldown keybinds**: The footer in `Drilldown.tsx` shows `r retry  s skip` but these
   are not wired in `useInput`. Add the handlers, mirroring the `R`/`S` logic in `Manage.tsx`.

## Context

### StatusLine

`StatusLine` is a local component inside `Manage.tsx`:

```ts
function StatusLine({ columns, selectedRun, selectedPhaseIndex, allRuns }) {
  // ...
  const diskSize = estimateDiskSize(selectedRun.worktree_path);
  // estimateDiskSize always returns '~?MB'

  return (
    <Box flexDirection="column">
      <Text>selected  {repoName}/{plan} · {status} · {position}</Text>
      <Text>          worktree {id} · {diskSize}</Text>
    </Box>
  );
}
```

Missing: ETA, `‖ paused` suffix, real disk size.

ETA formula (same as UpNext in WatchBottomStrip): remaining incomplete phases × 5 min.

Disk size: replace the stub with a synchronous `execSync('du -sh <path>')` call,
or fall back to `'?'` on error.

### Drilldown

`Drilldown.tsx` `useInput` handles: `esc`, `↑↓/k/j`, `l`, `e`, `d`.  
It does NOT handle `r` (retry) or `s` (skip) despite listing them in the footer.

The retry and skip logic from `Manage.tsx`:
- **Retry** (`R`): kill PID if set → `updatePhase(runId, phase.number, { status: 'pending', retry_count: 0 })` → `updateMeta(runId, { status: 'queued' })`
- **Skip** (`S`): `updatePhase(runId, phase.number, { status: 'failed', summary: 'skipped by user' })` → find next phase → set next phase to `pending` → `updateMeta(runId, { status: 'queued' })`

`Drilldown` already has access to `runId` and `meta` (loaded via `readMeta`).
It also needs the active PID — read it from `meta.claude_pid`.

## Files expected to change

| File | Change |
|---|---|
| `src/tui/Manage.tsx` | Improve `estimateDiskSize`; add ETA and `‖ paused` to `StatusLine` |
| `src/tui/Drilldown.tsx` | Wire `r` retry and `s` skip in `useInput` |

## Edge cases

- `du -sh` may not be available on all platforms — wrap in try/catch, fall back to `'?'`.
- Retry from Drilldown: `meta.claude_pid` may be undefined (phase already finished) —
  skip the kill step safely.
- Skip from Drilldown: if there is no next phase, `updateMeta` should still set run to
  `queued` so the runner can do the finalise step.
- StatusLine: ETA should show `—` when `selectedRun` is null or has no remaining phases.
- The `isPaused` value is not currently passed to `StatusLine` — it must be threaded
  through from `Manage`'s `qs.isPaused`.
