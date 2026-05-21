Read docs/tui-design-gaps/PHASE_04.md for full context before starting.

**Idempotency**: Before each significant action (creating a file, running a migration, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after a rate-limit interruption.

**PROGRESS.md update**: At the start of this phase, update `docs/tui-design-gaps/PROGRESS.md`: set the status for phase 4 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with the message `feat: phase 04 — CommandBar improvements and Manage paused banner`. Do not make intermediate commits during the phase. If you find the working tree already has a commit for this phase (check `git log --oneline -3`), skip the commit step.

**Structured output**: Your final message in this conversation must be a JSON object matching the schema you have been given. Do all your work using tools first, then emit only the JSON as your closing message.

---

## Task

Add pane-sensitive highlighting to CommandBar; add `q quit`; add yellow paused banner in Manage; add paused message in ExecutingPane.

## Branch

Ensure you are on `feature/tui-design-gaps`.

## Step 1 — Update `CommandBar.tsx`

File: `src/tui/components/CommandBar.tsx`

### 1a — Use `focusedPane` for row label colours

Change the row labels so the focused pane's label is brighter:

```tsx
const queueLabelColor = focusedPane === 'queue' ? cyan : dim;
const runLabelColor = focusedPane === 'executing' ? cyan : dim;
```

Update the render to use these colours:

```tsx
<Text>
  <Text color={queueLabelColor} bold={'queue' === focusedPane}>{'QUEUE  '}</Text>
  <Text color={dim}>{'↑↓ select  ⌥↑↓ reorder  ↵ phases  '}</Text>
  {pauseLabel}
  <Text color={dim}>{'  r remove  a add plan'}</Text>
</Text>
<Text>
  <Text color={runLabelColor} bold={'executing' === focusedPane}>{'RUN    '}</Text>
  <Text color={sessionActive ? dim : dim}>{'R retry phase  S skip phase  '}</Text>
  <Text color={sessionActive ? fg : dim}>{'K kill session'}</Text>
  <Text color={dim}>{'  e $EDITOR  l log  : palette  q quit'}</Text>
  {!sessionActive && <Text color={dim}>{'  [no session]'}</Text>}
</Text>
```

Import `cyan` from `'../theme.js'` (add to existing imports).

## Step 2 — Add paused banner in `Manage.tsx`

File: `src/tui/Manage.tsx`

### 2a — Add banner row

In the `Manage` return JSX, between the comment `{/* Triptych */}` and the `<Box flexDirection="row" flexGrow={1}>` triptych box, add:

```tsx
{/* Paused banner */}
{qs.isPaused && (
  <Text color={yellow} dimColor>
    {'‖‖ QUEUE PAUSED · currently-executing phase finishes, then waits · press p to resume'}
  </Text>
)}
```

### 2b — Adjust height to account for the banner

The outer `<Box>` currently has `height={rows - 2}`. When the paused banner is showing,
it consumes one extra row. Change to:

```tsx
<Box flexDirection="column" width={columns} height={rows - (qs.isPaused ? 3 : 2)} overflow="hidden">
```

### 2c — Pass `isPaused` to `ExecutingPane`

Update the `<ExecutingPane>` usage:

```tsx
<ExecutingPane
  runMeta={qs.activeRun}
  activePhase={qs.activePhase}
  events={events}
  focused={focusedPane === 'executing'}
  isPaused={qs.isPaused}
/>
```

Import `yellow` from `'./theme.js'` if not already imported.

## Step 3 — Update `ExecutingPane.tsx`

File: `src/tui/components/ExecutingPane.tsx`

### 3a — Add `isPaused` prop

Update the `Props` interface:

```ts
interface Props {
  runMeta: RunMeta | null;
  activePhase: PhaseEntry | null;
  events: ActivityEvent[];
  focused: boolean;
  isPaused?: boolean;
}
```

### 3b — Render paused message

In the active-run branch (inside the `<>` fragment that shows phase details), add a row
after the session ID / dots line:

```tsx
<Text color={dim2}>{'session ' + (activePhase.session_id?.slice(0, 8) ?? '—') + '…'}</Text>
{isPaused && (
  <Text color={yellow}>{'‖ this phase will finish · queue won't advance'}</Text>
)}
<Text color={dim}>{'····················'}</Text>
```

Import `yellow` from `'../theme.js'`.

## Step 4 — Verify

```
bun run typecheck
bun run build
```

## Acceptance criteria

- [ ] When queue pane is focused, `QUEUE` label in CommandBar is highlighted (cyan/bold); when executing pane is focused, `RUN` label is highlighted
- [ ] `q quit` appears at the end of the RUN keybind row
- [ ] When `qs.isPaused` is true in Manage, a yellow `‖‖ QUEUE PAUSED …` banner appears between header and triptych
- [ ] The Manage outer container height compensates for the banner row when paused
- [ ] When `isPaused` is true, ExecutingPane shows `‖ this phase will finish · queue won't advance` in yellow
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes

## Reference

- `src/tui/components/CommandBar.tsx` — current render (line ~17)
- `src/tui/Manage.tsx` — Manage return JSX, `{/* Triptych */}` comment (line ~341), outer Box height (line ~340), ExecutingPane usage (line ~358)
- `src/tui/components/ExecutingPane.tsx` — session line (line ~51), props interface (line ~9)
- `src/tui/theme.ts` — `yellow`, `cyan` exports
