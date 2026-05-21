Read docs/tui-design-gaps/PHASE_03.md for full context before starting.

**Idempotency**: Before each significant action (creating a file, running a migration, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after a rate-limit interruption.

**PROGRESS.md update**: At the start of this phase, update `docs/tui-design-gaps/PROGRESS.md`: set the status for phase 3 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with the message `feat: phase 03 — StatusLine improvements and Drilldown keybinds`. Do not make intermediate commits during the phase. If you find the working tree already has a commit for this phase (check `git log --oneline -3`), skip the commit step.

**Structured output**: Your final message in this conversation must be a JSON object matching the schema you have been given. Do all your work using tools first, then emit only the JSON as your closing message.

---

## Task

Fix the StatusLine in Manage to show ETA and paused state. Wire the `r` and `s` keybinds in Drilldown.

## Branch

Ensure you are on `feature/tui-design-gaps`.

## Step 1 — Fix `estimateDiskSize` in `Manage.tsx`

File: `src/tui/Manage.tsx`

Replace the stub function:

```ts
function estimateDiskSize(worktreePath: string): string {
  try {
    const result = execSync('du -sh ' + JSON.stringify(worktreePath), {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return result.split('\t')[0]?.trim() ?? '?';
  } catch {
    return '?';
  }
}
```

Add the import at the top of the file:

```ts
import { execSync } from 'child_process';
```

## Step 2 — Update `StatusLine` in `Manage.tsx`

### 2a — Add `isPaused` prop

Update the `StatusLine` component signature to accept `isPaused: boolean`:

```ts
function StatusLine({
  columns, selectedRun, selectedPhaseIndex, allRuns, isPaused,
}: {
  columns: number;
  selectedRun: RunMeta | null;
  selectedPhaseIndex: number;
  allRuns: RunMeta[];
  isPaused: boolean;
}) { ... }
```

### 2b — Compute ETA

Inside `StatusLine`, after the existing position computation, add:

```ts
const remainingPhases = selectedRun
  ? selectedRun.phases.filter(
      p => p.status !== 'complete' && p.status !== 'pr-created' && p.status !== 'failed',
    ).length
  : 0;
const etaMin = remainingPhases * 5;
const etaStr = remainingPhases > 0
  ? (etaMin >= 60
    ? `~${Math.floor(etaMin / 60)}h ${etaMin % 60}m`
    : `~${etaMin}m`)
  : '—';
```

### 2c — Update the first status line to include ETA and paused suffix

Change the first `<Text>` line:

```tsx
<Text>
  <Text color={dim}>{'selected  '}</Text>
  <Text color={fg}>{repoName + '/' + selectedRun.plan_folder + ' · ' + selectedRun.status + ' · ' + posStr + ' · eta ' + etaStr}</Text>
  {isPaused && <Text color={yellow}>{'  ‖ paused'}</Text>}
</Text>
```

Import `yellow` from `'./theme.js'` if not already imported.

### 2d — Pass `isPaused` from the Manage render

Find where `<StatusLine>` is rendered in the `Manage` return and add the prop:

```tsx
<StatusLine
  columns={columns}
  selectedRun={selectedRun}
  selectedPhaseIndex={selectedPhaseIndex}
  allRuns={allRuns}
  isPaused={qs.isPaused}
/>
```

## Step 3 — Wire `r` and `s` in `Drilldown.tsx`

File: `src/tui/Drilldown.tsx`

### 3a — Import `updatePhase` and `updateMeta`

These are already imported in `Manage.tsx`; add the same imports to `Drilldown.tsx`:

```ts
import { readMeta, getLogsDir, updatePhase, updateMeta } from '../storage/meta.js';
```

(Replace the existing `readMeta, getLogsDir` import with this expanded version.)

### 3b — Add `r` and `s` handlers in `useInput`

Inside the `useInput` callback, after the `d` handler and before the catch-all, add:

```ts
if (input === 'r' && phase) {
  // Retry: reset phase to pending, set run back to queued
  const pid = meta.claude_pid;
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
  updatePhase(runId, phase.number, { status: 'pending', retry_count: 0 });
  updateMeta(runId, { status: 'queued' });
  // Reload meta so the left pane reflects the change
  try { meta = readMeta(runId); } catch {}
  return;
}

if (input === 's' && phase) {
  // Skip: mark failed, advance to next pending phase
  updatePhase(runId, phase.number, { status: 'failed', summary: 'skipped by user' });
  const nextPhase = meta.phases.find(p => p.number > phase.number);
  if (nextPhase) {
    updatePhase(runId, nextPhase.number, { status: 'pending' });
  }
  updateMeta(runId, { status: 'queued' });
  try { meta = readMeta(runId); } catch {}
  return;
}
```

Note: `meta` is declared with `let` at the top of `Drilldown` (it is currently declared with a
`const` inside a try/catch — change that outer declaration to `let` so it can be reassigned).

Check the actual variable declaration pattern in `Drilldown.tsx` before applying this change,
since the existing pattern uses:

```ts
let meta: RunMeta;
try {
  meta = readMeta(runId);
} catch { ... }
```

The variable is already `let` — just ensure `meta` is reassigned after retry/skip to keep
the in-memory view consistent.

## Step 4 — Verify

```
bun run typecheck
bun run build
```

## Acceptance criteria

- [ ] `estimateDiskSize` uses `execSync('du -sh …')` and returns a real size like `"12M"` or `"234K"` (falls back to `"?"` on error)
- [ ] StatusLine first line shows `eta ~Xh Ym` (or `~Xm` or `—`) after the run position
- [ ] StatusLine first line shows `‖ paused` in yellow when `qs.isPaused` is true
- [ ] `isPaused` is passed as a prop to `StatusLine` from `Manage`
- [ ] Drilldown: pressing `r` on a selected phase resets it to `pending` and the run to `queued`
- [ ] Drilldown: pressing `s` on a selected phase marks it `failed` and advances the next phase
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes

## Reference

- `src/tui/Manage.tsx` — `estimateDiskSize` (line ~27), `StatusLine` (line ~38), `R`/`S` handlers (line ~252)
- `src/tui/Drilldown.tsx` — `useInput` (line ~70), `meta` declaration (line ~53)
- `src/storage/meta.ts` — `updatePhase`, `updateMeta` signatures
- `src/tui/theme.ts` — `yellow` export
