Read docs/tui-design-gaps/PHASE_06.md for full context before starting.

**Idempotency**: Before each significant action (creating a file, running a migration, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after a rate-limit interruption.

**PROGRESS.md update**: At the start of this phase, update `docs/tui-design-gaps/PROGRESS.md`: set the status for phase 6 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with the message `feat: phase 06 — dynamic modal centering`. Do not make intermediate commits during the phase. If you find the working tree already has a commit for this phase (check `git log --oneline -3`), skip the commit step.

**Structured output**: Your final message in this conversation must be a JSON object matching the schema you have been given. Do all your work using tools first, then emit only the JSON as your closing message.

---

## Task

Make both Manage modals horizontally centred by computing `marginLeft` from the terminal `columns`.

## Branch

Ensure you are on `feature/tui-design-gaps`.

## Step 1 — Update `CommandPalette.tsx`

File: `src/tui/components/CommandPalette.tsx`

### 1a — Add `columns` prop

Update the `Props` interface:

```ts
interface Props {
  onClose: () => void;
  onRun: (command: string) => void;
  visible: boolean;
  columns: number;
}
```

### 1b — Compute `marginLeft` and apply height

Inside the component, compute:

```ts
const modalWidth = 80;
const marginLeft = Math.max(0, Math.floor((columns - modalWidth - 2) / 2));
```

Update the outer `<Box>` to use the computed `marginLeft` and add a height cap:

```tsx
<Box
  flexDirection="column"
  borderStyle="round"
  borderColor={cyan}
  backgroundColor={bgFloat}
  width={modalWidth}
  height={26}
  overflow="hidden"
  marginTop={4}
  marginLeft={marginLeft}
>
```

## Step 2 — Update `KillConfirmModal.tsx`

File: `src/tui/components/KillConfirmModal.tsx`

### 2a — Add `columns` prop

Update the `Props` interface:

```ts
interface Props {
  runMeta: RunMeta;
  phaseEntry: PhaseEntry;
  elapsedMs: number;
  onConfirm: () => void;
  onCancel: () => void;
  columns: number;
}
```

### 2b — Compute `marginLeft`

Inside the component, compute:

```ts
const modalWidth = 56;
const marginLeft = Math.max(0, Math.floor((columns - modalWidth - 2) / 2));
```

Update the outer `<Box>`:

```tsx
<Box
  flexDirection="column"
  borderStyle="round"
  borderColor={red}
  backgroundColor={bgFloat}
  width={modalWidth}
  marginTop={6}
  marginLeft={marginLeft}
>
```

## Step 3 — Update `Manage.tsx` to pass `columns`

File: `src/tui/Manage.tsx`

Update the `CommandPalette` render call:

```tsx
{showPalette && (
  <CommandPalette
    visible={showPalette}
    onClose={() => setShowPalette(false)}
    onRun={handlePaletteCommand}
    columns={columns}
  />
)}
```

Update the `KillConfirmModal` render call:

```tsx
{killConfirm && qs.activeRun && qs.activePhase && (
  <KillConfirmModal
    runMeta={qs.activeRun}
    phaseEntry={qs.activePhase}
    elapsedMs={elapsedMs}
    onConfirm={handleKill}
    onCancel={() => setKillConfirm(false)}
    columns={columns}
  />
)}
```

## Step 4 — Verify

```
bun run typecheck
bun run build
```

## Acceptance criteria

- [ ] `CommandPalette` accepts a `columns` prop
- [ ] `CommandPalette` `marginLeft` is computed as `Math.max(0, Math.floor((columns - 82) / 2))`
- [ ] `CommandPalette` has `height={26}` and `overflow="hidden"`
- [ ] `KillConfirmModal` accepts a `columns` prop
- [ ] `KillConfirmModal` `marginLeft` is computed as `Math.max(0, Math.floor((columns - 58) / 2))`
- [ ] Both `columns` props are wired in `Manage.tsx`
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes

## Reference

- `src/tui/components/CommandPalette.tsx` — Props interface (line ~9), outer Box (line ~65)
- `src/tui/components/KillConfirmModal.tsx` — Props interface (line ~8), outer Box (line ~38)
- `src/tui/Manage.tsx` — modal render calls (~line 382, ~line 390)
