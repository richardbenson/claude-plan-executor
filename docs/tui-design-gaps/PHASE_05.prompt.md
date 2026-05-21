Read docs/tui-design-gaps/PHASE_05.md for full context before starting.

**Idempotency**: Before each significant action (creating a file, running a migration, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after a rate-limit interruption.

**PROGRESS.md update**: At the start of this phase, update `docs/tui-design-gaps/PROGRESS.md`: set the status for phase 5 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with the message `feat: phase 05 — limit window real data and Watch paused polish`. Do not make intermediate commits during the phase. If you find the working tree already has a commit for this phase (check `git log --oneline -3`), skip the commit step.

**Structured output**: Your final message in this conversation must be a JSON object matching the schema you have been given. Do all your work using tools first, then emit only the JSON as your closing message.

---

## Task

Replace hardcoded stubs in LimitWindow with real data; add time-since-pause and paused tags; add "WHILE YOU WAIT" block.

## Branch

Ensure you are on `feature/tui-design-gaps`.

## Step 1 — Update `WatchBottomStrip.tsx`

File: `src/tui/components/WatchBottomStrip.tsx`

### 1a — Add hourly cost helper

Add this helper near the top of the file (above the component functions):

```ts
function buildHourlyWindow(): number[] {
  // 18 hourly buckets covering the last 18 hours (same as WatchHero sparkline)
  const slots = new Array<number>(18).fill(0);
  const now = new Date();
  for (const ev of activityBus.getBuffer()) {
    if (ev.kind !== 'ok') continue;
    const hoursAgo = (now.getTime() - ev.timestamp.getTime()) / 3_600_000;
    const idx = Math.floor(hoursAgo);
    if (idx >= 0 && idx < 18) {
      slots[17 - idx] = (slots[17 - idx] ?? 0) + ev.costUsd;
    }
  }
  return slots;
}
```

Import `activityBus` from `'../../events/bus.js'` (add to existing imports).

### 1b — Update `LimitWindow`

Replace the hardcoded `▰▰▰▰▰▱▱▱▱▱▱▱▱▱ 0% used` and `Sparkline data={[0]}` with:

```tsx
function LimitWindow({ queueState, colWidth }: { queueState: QueueState; colWidth: number }): React.ReactElement {
  // ...existing countdown/reset logic...

  const isExhausted = queueState.isLimitPaused;
  const windowData = buildHourlyWindow();

  return (
    <Box flexDirection="column" width={colWidth}>
      <Text color={dim} bold>LIMIT WINDOW</Text>
      <Text color={magenta}>{countdownStr}</Text>
      {isExhausted ? (
        <Text color={magenta}>{'▰'.repeat(14)}<Text color={dim2}> 100% (limit hit)</Text></Text>
      ) : (
        <Text color={dim}>{'▱'.repeat(14)}<Text color={dim2}> window open</Text></Text>
      )}
      {resetStr ? <Text color={dim}>{resetStr}</Text> : <Text color={dim}>no limit active</Text>}
      <Box>
        <Text color={dim}>cost this window  </Text>
        <Sparkline data={windowData.slice(-5)} width={8} color={isExhausted ? magenta : dim2} />
      </Box>
    </Box>
  );
}
```

### 1c — Add `‖ paused` tags in `UpNext`

In the `UpNext` component, after the run label text, add the paused tag when `isPaused`:

Change this part of the map:

```tsx
next3.map((run, i) => {
  const repo = path.basename(run.primary_repo_path);
  const label = `${repo}/${run.plan_folder}`.slice(0, 14);
  return (
    <Box key={run.id}>
      <Text color={dim2}>{String(i + 1).padStart(2)} </Text>
      <StateChip status="queued" showLabel={false} />
      <Text color={fg}> {label}</Text>
    </Box>
  );
})
```

to:

```tsx
next3.map((run, i) => {
  const repo = path.basename(run.primary_repo_path);
  const label = `${repo}/${run.plan_folder}`.slice(0, 12);
  return (
    <Box key={run.id}>
      <Text color={dim2}>{String(i + 1).padStart(2)} </Text>
      <StateChip status="queued" showLabel={false} />
      <Text color={fg}> {label}</Text>
      {queueState.isPaused && <Text color={yellow}>  ‖</Text>}
    </Box>
  );
})
```

Import `yellow` from `'../theme.js'` (add to imports).

## Step 2 — Update `WatchPaused.tsx`

File: `src/tui/components/WatchPaused.tsx`

### 2a — Add time-since-pause helper

Add this helper near the top of the file:

```ts
function formatAgo(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

function getPausedAgo(): string | null {
  const buf = activityBus.getBuffer();
  for (let i = buf.length - 1; i >= 0; i--) {
    const ev = buf[i];
    if (ev?.kind === 'pause') {
      return formatAgo(Date.now() - ev.timestamp.getTime());
    }
  }
  return null;
}
```

Import `activityBus` from `'../../events/bus.js'` (add to imports if not already present).

### 2b — Add time-since-pause to `UserPausedHero`

Change the header line in `UserPausedHero`:

```tsx
<Text color={yellow} bold>{'‖ QUEUE PAUSED · by user'}</Text>
```

to:

```tsx
<Text color={yellow} bold>{'‖ QUEUE PAUSED · by user' + (getPausedAgo() ? ' · ' + getPausedAgo() : '')}</Text>
```

### 2c — Add "WHILE YOU WAIT" block to `LimitPausedFull`

In `LimitPausedFull`, after the `WHAT'S WAITING` section (the `<Box flexDirection="column" paddingLeft={1} marginTop={1}>` that renders `allWaiting`), add:

```tsx
{/* While you wait */}
<Box flexDirection="column" paddingLeft={1} marginTop={1}>
  <Text color={dim} bold>WHILE YOU WAIT</Text>
  <Text color={dim2}>{'· cpe will auto-resume when the window resets'}</Text>
  <Text color={dim2}>{'· the current phase (if any) has been stopped and will retry'}</Text>
  {queueState.limitResumeAt && (
    <Text color={dim2}>{'· check back at ' + queueState.limitResumeAt.toLocaleTimeString()}</Text>
  )}
</Box>
```

## Step 3 — Verify

```
bun run typecheck
bun run build
```

## Acceptance criteria

- [ ] LimitWindow sparkline uses real hourly cost data from `activityBus` (not hardcoded zeros)
- [ ] When `isLimitPaused` is true, LimitWindow shows `▰▰▰▰▰▰▰▰▰▰▰▰▰▰ 100% (limit hit)` in magenta
- [ ] When not limit-paused, LimitWindow shows `▱▱▱▱▱▱▱▱▱▱▱▱▱▱ window open` in dim
- [ ] UpNext: when queue is paused, each queued run row shows a yellow `‖` tag
- [ ] UserPausedHero header shows `‖ QUEUE PAUSED · by user · Xm ago` (when a pause event exists)
- [ ] LimitPausedFull shows a "WHILE YOU WAIT" block with auto-resume explanation
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes

## Reference

- `src/tui/components/WatchBottomStrip.tsx` — `LimitWindow` (~line 64), `UpNext` (~line 27)
- `src/tui/components/WatchPaused.tsx` — `UserPausedHero` (~line 26), `LimitPausedFull` (~line 54)
- `src/tui/components/WatchHero.tsx` — `buildHourlySparkline()` for reference implementation
- `src/events/bus.js` — `activityBus.getBuffer()` returns `ActivityEvent[]`
- `src/tui/theme.ts` — `yellow`, `magenta`, `dim`, `dim2` exports
