Read docs/tui-design-gaps/PHASE_01.md for full context before starting.

**Idempotency**: Before each significant action (creating a file, running a migration, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after a rate-limit interruption.

**PROGRESS.md update**: At the start of this phase, update `docs/tui-design-gaps/PROGRESS.md`: set the status for phase 1 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with the message `feat: phase 01 — phase titles throughout TUI`. Do not make intermediate commits during the phase. If you find the working tree already has a commit for this phase (check `git log --oneline -3`), skip the commit step.

**Structured output**: Your final message in this conversation must be a JSON object matching the schema you have been given. Do all your work using tools first, then emit only the JSON as your closing message.

---

## Task

Introduce a human-readable `title` field on `PhaseEntry` and render it everywhere in the TUI that currently falls back to the raw filename.

## Branch

Ensure you are on `feature/tui-design-gaps`. If the branch does not exist, create it from `main`.

## Step 1 — Add `title` to the data model

File: `src/types/meta.ts`

Add `title?: string` to `PhaseEntry` after the `prompt_file` field:

```ts
export interface PhaseEntry {
  number: number;
  prompt_file: string;
  title?: string;          // ← add this
  status: PhaseStatus;
  ...
}
```

## Step 2 — Add `extractPhaseTitle` helper

File: `src/storage/meta.ts`

Add a new exported function at the bottom of the file:

```ts
export function extractPhaseTitle(
  worktreePath: string,
  planFolder: string,
  promptFile: string,
): string | undefined {
  // promptFile is like "PHASE_04.prompt.md" → plan doc is "PHASE_04.md"
  const docName = promptFile.replace('.prompt.md', '.md');
  const docPath = path.join(worktreePath, 'docs', planFolder, docName);
  try {
    const content = fs.readFileSync(docPath, 'utf8');
    const m = content.match(/^#{1,4}\s+Phase\s+\d+\s+—\s+(.+)$/m);
    return m?.[1]?.trim();
  } catch {
    return undefined;
  }
}
```

## Step 3 — Populate title at queue time

File: `src/commands/queue.ts`

Import `extractPhaseTitle` from `'../storage/meta.js'`.

In the `phases` array inside `queuePlan()`, add the `title` field:

```ts
const phases = phaseFiles.map(f => ({
  number: parseInt(f.match(/PHASE_(\d+)/)![1]!, 10),
  prompt_file: f,
  title: extractPhaseTitle(worktreePath, folder, f),
  status: 'pending' as const,
  retry_count: 0,
}));
```

## Step 4 — WatchHero: use title with fallback

File: `src/tui/components/WatchHero.tsx`

Currently the phase line reads:
```ts
{activePhase ? ` — ${path.basename(activePhase.prompt_file, '.prompt.md')}` : ''}
```

Change to:
```ts
{activePhase
  ? ` — ${activePhase.title ?? path.basename(activePhase.prompt_file, '.prompt.md').replace('PHASE_', 'phase ')}`
  : ''}
```

Remove the `import * as path` if it is no longer needed after this change (check — it may still be used for `repoBasename`).

## Step 5 — PhasesPane: use title + fix selection colour

File: `src/tui/components/PhasesPane.tsx`

1. In the `phaseLabel` helper, keep it as the last-resort fallback only.

2. Change the phase row label expression from:
```ts
const label = phaseLabel(phase.prompt_file);
```
to:
```ts
const label = phase.title ?? phaseLabel(phase.prompt_file);
```

3. Fix the selection highlight: change `bgHi` to `bgFloat`:
```ts
backgroundColor={selected ? bgFloat : undefined}
```

4. Import `bgFloat` from `'../theme.js'` (it is already exported from `theme.ts`).
   Remove the `bgHi` import if it is no longer used in this file.

## Step 6 — Drilldown: use title in left pane

File: `src/tui/Drilldown.tsx`

In the phase list map, the row currently renders:
```ts
const label = phaseLabel(p.prompt_file);
```

Change to:
```ts
const label = p.title ?? phaseLabel(p.prompt_file);
```

## Step 7 — Verify

Run:
```
bun run typecheck
bun run build
```

Both must pass with no errors before committing.

## Acceptance criteria

- [ ] `PhaseEntry` in `src/types/meta.ts` has an optional `title?: string` field
- [ ] `extractPhaseTitle` is exported from `src/storage/meta.ts` and reads `PHASE_NN.md`
- [ ] `queuePlan` in `src/commands/queue.ts` populates `title` for each phase
- [ ] `WatchHero` shows the phase title (e.g. "Login failure & lockout tests") not "PHASE_04"
- [ ] `PhasesPane` shows the phase title and uses `bgFloat` for selected rows
- [ ] `Drilldown` left pane shows phase titles
- [ ] All three components fall back gracefully when `title` is undefined
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes

## Reference

- `src/types/meta.ts` — full `PhaseEntry` interface
- `src/commands/queue.ts` — `queuePlan()`, the `phases` array construction at line ~84
- `src/tui/components/PhasesPane.tsx` — current `phaseLabel()` helper and row rendering
- `src/tui/components/WatchHero.tsx` — phase line at the `activePhase` check
- `src/tui/Drilldown.tsx` — left pane `phases.map()` at line ~114
- `src/tui/theme.ts` — `bgFloat`, `bgHi` exported constants
