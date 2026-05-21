# Phase 1 — Phase titles throughout TUI

## Summary

Introduce a `title` field on `PhaseEntry` populated at queue time by reading the plan's
`PHASE_NN.md` document. Surface the title everywhere in the TUI that currently falls back
to the raw filename (`PHASE_04` instead of `Login failure & lockout tests`). Also fix the
PhasesPane selection highlight colour (`bgFloat` per §5.1, not `bgHi`).

## Context

Currently phases are created in `src/commands/queue.ts` inside `queuePlan()`:

```ts
const phases = phaseFiles.map(f => ({
  number: parseInt(f.match(/PHASE_(\d+)/)![1]!, 10),
  prompt_file: f,
  status: 'pending' as const,
  retry_count: 0,
}));
```

There is no `title` field. Components derive a label like this:

```ts
path.basename(activePhase.prompt_file, '.prompt.md')  // → "PHASE_04"
```

Each plan's `PHASE_NN.md` file always contains a heading on its first heading line:

```
## Phase 4 — Login failure & lockout tests
```

The regex `/^#{1,4}\s+Phase\s+\d+\s+—\s+(.+)$/m` reliably extracts the title.

## Files expected to change

| File | Change |
|---|---|
| `src/types/meta.ts` | Add `title?: string` to `PhaseEntry` |
| `src/commands/queue.ts` | Populate `title` when building the phases array |
| `src/storage/meta.ts` | Add `extractPhaseTitle()` helper |
| `src/tui/components/WatchHero.tsx` | Use `activePhase.title` with fallback |
| `src/tui/components/PhasesPane.tsx` | Use `phase.title`; fix selection to `bgFloat` |
| `src/tui/Drilldown.tsx` | Use `p.title` in left-pane phase list |

## Edge cases

- PHASE_NN.md may not exist (plan created before this change, or file deleted). Fall back
  to the filename-derived label `PHASE_NN`.
- The regex must not capture the trailing newline or extra whitespace.
- Existing `PhaseEntry` records already stored in `meta.json` won't have a `title` field —
  the field is optional so they deserialise cleanly; the TUI falls back gracefully.
- The `extractPhaseTitle` helper reads from `<worktreePath>/docs/<planFolder>/PHASE_NN.md`,
  where `PHASE_NN` is derived from `prompt_file` by stripping `.prompt.md`.
