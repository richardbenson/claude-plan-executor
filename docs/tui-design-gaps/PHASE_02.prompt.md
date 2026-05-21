Read docs/tui-design-gaps/PHASE_02.md for full context before starting.

**Idempotency**: Before each significant action (creating a file, running a migration, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after a rate-limit interruption.

**PROGRESS.md update**: At the start of this phase, update `docs/tui-design-gaps/PROGRESS.md`: set the status for phase 2 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with the message `feat: phase 02 — header live indicator and ActivityFeed label`. Do not make intermediate commits during the phase. If you find the working tree already has a commit for this phase (check `git log --oneline -3`), skip the commit step.

**Structured output**: Your final message in this conversation must be a JSON object matching the schema you have been given. Do all your work using tools first, then emit only the JSON as your closing message.

---

## Task

Add a live indicator and elapsed time to the header; update status text for paused states; add "LIVE ACTIVITY" label to the activity feed.

## Branch

Ensure you are on `feature/tui-design-gaps`.

## Step 1 — Update `Header.tsx`

File: `src/tui/components/Header.tsx`

### 1a — Replace `elapsed` prop with `startedAt`

Change the `Props` interface:

```ts
interface Props {
  mode: 'WATCH' | 'MANAGE';
  statusText: string;
  sessionActive?: boolean;   // ← replaces elapsed
  startedAt?: Date;          // ← replaces elapsed
}
```

### 1b — Add elapsed time formatting

Add a helper inside the file (not exported):

```ts
function formatElapsed(startedAt: Date): string {
  const ms = Date.now() - startedAt.getTime();
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `active ${h}h ${m}m`;
  return `active ${m}m`;
}
```

### 1c — Add per-minute state for elapsed display

Inside `Header`, add:

```ts
const [elapsedStr, setElapsedStr] = useState(() =>
  startedAt ? formatElapsed(startedAt) : '',
);

useEffect(() => {
  if (!startedAt) return;
  setElapsedStr(formatElapsed(startedAt));
  const id = setInterval(() => setElapsedStr(formatElapsed(startedAt)), 60_000);
  return () => clearInterval(id);
}, [startedAt]);
```

### 1d — Update the render

Change the left side to include the `●` live indicator when `sessionActive`:

```tsx
<Box>
  <Text color={blue}>▮ cpe</Text>
  <Text color={borderHi}> · </Text>
  <Text color={modeColor} bold>{mode}</Text>
  <Text color={borderHi}> · </Text>
  {sessionActive && <Text color={green}>● </Text>}
  <Text color={fgDark}>{statusText}</Text>
</Box>
```

Import `green` from `'../theme.js'`.

Change the right side to show elapsed time alongside datetime:

```tsx
<Box>
  {elapsedStr && <Text color={dim}>today · {elapsedStr}  </Text>}
  <Text color={dim}>{datetime}</Text>
</Box>
```

## Step 2 — Update `App.tsx`

File: `src/tui/App.tsx`

### 2a — Import `useQueueState`

Add to imports:

```ts
import { useQueueState } from './hooks/useQueueState.js';
```

### 2b — Track `sessionStartedAt`

Add state inside the `App` component:

```ts
const queueState = useQueueState();
const [sessionStartedAt, setSessionStartedAt] = useState<Date | null>(null);
```

In the existing `useEffect` that subscribes to `activityBus`, add:

```ts
if (event.kind === 'phase' && !sessionStartedAt) {
  setSessionStartedAt(event.timestamp);
}
```

(Note: the `useEffect` dependency array should include `sessionStartedAt` — or restructure
to use a ref to avoid capturing stale state. The simplest approach is to use a ref:

```ts
const sessionStartedAtRef = React.useRef<Date | null>(null);
const [sessionStartedAt, setSessionStartedAt] = useState<Date | null>(null);

// In the effect:
if (event.kind === 'phase' && !sessionStartedAtRef.current) {
  sessionStartedAtRef.current = event.timestamp;
  setSessionStartedAt(event.timestamp);
}
```
)

### 2c — Derive rich status text

Replace the existing `queueStatusText` derivation with:

```ts
const queueStatusText = queueState.isLimitPaused
  ? 'queue paused · waiting on 5h limit window'
  : queueState.isPaused
  ? 'queue paused · by user'
  : sessionActive
  ? 'queue chewing'
  : 'queue idle';
```

Remove the now-unused `recentPhaseEvent` variable if it is no longer needed.

### 2d — Pass new props to Header

Update the `<Header>` call:

```tsx
<Header
  mode={mode.toUpperCase() as 'WATCH' | 'MANAGE'}
  statusText={queueStatusText}
  sessionActive={sessionActive}
  startedAt={sessionStartedAt ?? undefined}
/>
```

## Step 3 — Update `ActivityFeed.tsx`

File: `src/tui/components/ActivityFeed.tsx`

In the JSX, change the header section from:

```tsx
<Box>
  <Text> </Text>
  <Text color={green}>●</Text>
  <Text color={dim}> streaming session </Text>
  <Text color={green2}>{shortSession}…</Text>
</Box>
```

to:

```tsx
<Box>
  <Text color={dim} bold>LIVE ACTIVITY </Text>
  <Text color={green}>●</Text>
  <Text color={dim}> streaming session </Text>
  <Text color={green2}>{shortSession}…</Text>
</Box>
```

## Step 4 — Verify

```
bun run typecheck
bun run build
```

## Acceptance criteria

- [ ] `Header` accepts `sessionActive?: boolean` and `startedAt?: Date`; the old `elapsed` prop is removed
- [ ] When `sessionActive` is true, a green `●` appears before the status text in the header
- [ ] When `startedAt` is set, the header right side shows `today · active Xh Ym`
- [ ] When queue is limit-paused, status text reads `queue paused · waiting on 5h limit window`
- [ ] When queue is user-paused, status text reads `queue paused · by user`
- [ ] ActivityFeed header line reads `LIVE ACTIVITY ● streaming session a7f3b2…`
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes

## Reference

- `src/tui/App.tsx` — App component, existing activityBus subscription at line ~49
- `src/tui/components/Header.tsx` — existing `formatDatetime` + `elapsed` prop pattern
- `src/tui/components/ActivityFeed.tsx` — the header Box at line ~119
- `src/tui/hooks/useQueueState.ts` — `isPaused`, `isLimitPaused` on `QueueState`
- `src/tui/theme.ts` — `green`, `dim`, `dim2`, `blue` exports
