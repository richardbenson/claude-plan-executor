Read docs/tui-design-gaps/PHASE_07.md for full context before starting.

**Idempotency**: Before each significant action (creating a file, running a migration, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after a rate-limit interruption.

**PROGRESS.md update**: At the start of this phase, update `docs/tui-design-gaps/PROGRESS.md`: set the status for phase 7 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with the message `feat: phase 07 — responsive 80x24 compact layout`. Do not make intermediate commits during the phase. If you find the working tree already has a commit for this phase (check `git log --oneline -3`), skip the commit step.

**Structured output**: Your final message in this conversation must be a JSON object matching the schema you have been given. Do all your work using tools first, then emit only the JSON as your closing message.

---

## Task

Add a compact layout branch to Watch, Manage, and Header for terminals with `columns < 100 || rows < 30`.

## Branch

Ensure you are on `feature/tui-design-gaps`.

## Step 1 — Update `Header.tsx` to support compact mode

File: `src/tui/components/Header.tsx`

### 1a — Add `compact` prop

```ts
interface Props {
  mode: 'WATCH' | 'MANAGE';
  statusText: string;
  sessionActive?: boolean;
  startedAt?: Date;
  compact?: boolean;
}
```

### 1b — Conditional render

In compact mode, omit the right side (datetime + elapsed) entirely:

```tsx
return (
  <Box flexDirection="row" justifyContent="space-between">
    <Box>
      <Text color={blue}>▮ cpe</Text>
      <Text color={borderHi}> · </Text>
      <Text color={modeColor} bold>{mode}</Text>
      <Text color={borderHi}> · </Text>
      {sessionActive && <Text color={green}>● </Text>}
      <Text color={fgDark}>{statusText}</Text>
    </Box>
    {!compact && (
      <Box>
        {elapsedStr && <Text color={dim}>today · {elapsedStr}  </Text>}
        <Text color={dim}>{datetime}</Text>
      </Box>
    )}
  </Box>
);
```

## Step 2 — Update `App.tsx`

File: `src/tui/App.tsx`

### 2a — Derive `compact`

Inside `App`, after `useStdoutDimensions()`:

```ts
const compact = columns < 100 || rows < 30;
```

### 2b — Pass `compact` to `Header` and children

```tsx
<Header
  mode={mode.toUpperCase() as 'WATCH' | 'MANAGE'}
  statusText={queueStatusText}
  sessionActive={sessionActive}
  startedAt={sessionStartedAt ?? undefined}
  compact={compact}
/>
```

Pass `compact` to Watch and Manage — they already receive `columns` and `rows` so they can
derive it themselves. However, passing it explicitly avoids duplication:

```tsx
{mode === 'watch'
  ? <Watch columns={columns} rows={rows} compact={compact} />
  : <Manage columns={columns} rows={rows} compact={compact} />}
```

## Step 3 — Update `Watch.tsx` for compact layout

File: `src/tui/Watch.tsx`

### 3a — Add `compact` prop

```ts
interface Props {
  columns: number;
  rows: number;
  compact?: boolean;
}
```

### 3b — Compact Watch layout

When `compact` is true, render a simplified layout (no bottom strip, collapsed hero):

```tsx
export function Watch({ columns, rows, compact }: Props): React.ReactElement {
  // ...existing state...

  if (compact) {
    const { activeRun, activePhase } = queueState;
    const feedRows = Math.max(2, rows - 6);
    return (
      <Box flexDirection="column" width={columns} height={rows - 1}>
        {/* Collapsed hero: 2 lines */}
        <Box flexDirection="row">
          {activeRun ? (
            <>
              <Text color={cyan}>{activeRun.plan_folder}</Text>
              <Text color={dim}>{' phase ' + (activePhase?.number ?? '?') + '/' + activeRun.phases.length}</Text>
            </>
          ) : (
            <Text color={dim}>idle — no active run</Text>
          )}
        </Box>

        {/* Activity feed fills remaining space */}
        <Box flexDirection="column" flexGrow={1}>
          <ActivityFeed
            events={events}
            availableRows={feedRows}
            activeSessionId={queueState.activeRun?.id}
          />
        </Box>

        {/* Single-row footer */}
        <Text color={dim2}> v manage  q quit</Text>
      </Box>
    );
  }

  // ...existing full layout (unchanged)...
}
```

The compact Watch branch handles limit-paused and user-paused with the same abbreviated
hero line — no full-screen replacement is used in compact mode.

## Step 4 — Update `Manage.tsx` for compact layout

File: `src/tui/Manage.tsx`

### 4a — Add `compact` prop

```ts
interface Props {
  columns: number;
  rows: number;
  compact?: boolean;
}
```

### 4b — Compact Manage layout

When `compact` is true, show only the focused pane:

```tsx
export function Manage({ columns, rows, compact }: Props): React.ReactElement {
  // ...existing state...

  if (compact) {
    // Single-pane view; Tab cycles queue → phases → executing
    const paneHeight = rows - 3; // header + status + keybind rows

    let activePane: React.ReactElement;
    if (focusedPane === 'queue') {
      activePane = (
        <QueuePane
          runs={allRuns}
          selectedIndex={selectedRunIndex}
          focused={true}
          onSelect={setSelectedRunIndex}
        />
      );
    } else if (focusedPane === 'phases') {
      activePane = (
        <PhasesPane
          phases={phasesForSelectedRun}
          selectedRun={selectedRun}
          selectedIndex={selectedPhaseIndex}
          focused={true}
          onSelect={setSelectedPhaseIndex}
          isPaused={qs.isPaused}
        />
      );
    } else {
      activePane = (
        <ExecutingPane
          runMeta={qs.activeRun}
          activePhase={qs.activePhase}
          events={events}
          focused={true}
          isPaused={qs.isPaused}
        />
      );
    }

    return (
      <Box flexDirection="column" width={columns} height={rows - 1} overflow="hidden">
        <Box flexGrow={1} height={paneHeight}>
          {activePane}
        </Box>
        <Text color={dim}>
          {'selected  ' + (selectedRun ? selectedRun.plan_folder + ' · ' + selectedRun.status : '—')}
        </Text>
        <Text color={dim}>{'Tab pane  ↑↓ select  ↵ open  p pause  K kill  q quit'}</Text>

        {/* Modals still work in compact mode */}
        {showPalette && (
          <CommandPalette
            visible={showPalette}
            onClose={() => setShowPalette(false)}
            onRun={handlePaletteCommand}
            columns={columns}
          />
        )}
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
      </Box>
    );
  }

  // ...existing full layout (unchanged)...
}
```

## Step 5 — Verify

```
bun run typecheck
bun run build
```

To manually test, resize your terminal to 80×24 and run `cpe start`.

## Acceptance criteria

- [ ] `Header` accepts `compact?: boolean` and omits the datetime/elapsed section in compact mode
- [ ] `App.tsx` derives `compact = columns < 100 || rows < 30` and passes it to Header, Watch, Manage
- [ ] `Watch` in compact mode shows a 2-line collapsed hero + activity feed + single footer row; no bottom strip
- [ ] `Manage` in compact mode shows a single pane at a time; `Tab` cycles queue → phases → executing
- [ ] Manage compact status line collapses to one row
- [ ] Full layouts are unchanged when `compact` is false (terminals ≥ 100×30)
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes

## Reference

- `src/tui/App.tsx` — `useStdoutDimensions()` usage and Header/Watch/Manage render (~line 87)
- `src/tui/Watch.tsx` — existing Props interface and early-return pattern for limit-paused
- `src/tui/Manage.tsx` — existing Props interface, drilldown early-return pattern (~line 322)
- `src/tui/components/Header.tsx` — Props interface and render return (~line 46)
- `docs/DESIGN.md` §7.1 — compact layout specification

After this phase, open one PR targeting `main` covering all 7 phases on the `feature/tui-design-gaps` branch.
