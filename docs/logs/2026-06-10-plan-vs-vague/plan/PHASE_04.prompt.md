Read docs/self-update/PHASE_04.md for context before starting, and docs/self-update/README.md for the overall feature requirements. Then read docs/DESIGN.md before touching any TUI file — it is the source of truth for layout, color, state mapping, and keybinds (this is a standing project rule from CLAUDE.md). You are working on branch feature/self-update — check it out; verify src/update/check.ts exists (Phase 02 committed) before starting; if it does not, stop and report that Phase 02 has not run.

**PROGRESS.md update**: At the start of this phase, update `PROGRESS.md`: set the status for this phase to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format. The file is docs/self-update/PROGRESS.md — update both the summary table row and the Phase Details entry.

**Idempotency**: Before each significant action (creating a file, running a migration, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after a rate-limit interruption.

## Task

Add the background auto-update loop to `cpe start` and a persistent "restart to apply" footer badge to all three TUI modes. Update DESIGN.md to specify the badge.

## Files to modify or create

1. `src/update/auto.ts` (new):
   - A module-scope badge store: `let installedUpdate: string | null` plus `getInstalledUpdate(): string | null` and `subscribeInstalledUpdate(fn: (tag: string) => void): () => void` (returns an unsubscribe function, mirroring the `activityBus.subscribe` contract in `src/events/bus.ts`). Module scope matters: the App unmounts and re-renders around interactive subprocesses (see the while-loop in `startCommand`), and the badge must survive that.
   - `startAutoUpdateLoop(config: AppConfig, deps?: {...}): () => void` — returns a stop function (clears the timer; `startCommand` may ignore it, but tests need it). Behaviour: no-op (return immediately) when `CPE_VERSION === 'dev'` or `config.update_auto === false`. Otherwise run a check shortly after startup (~30 s delay so launch is never slowed) and then every 6 h: `fetchLatestTag()` → if `isNewer(latest, CPE_VERSION)` → `downloadAndInstall(latest)` → set the store and notify subscribers → `writeUpdateState(...)`. A boolean in-flight guard must prevent overlapping runs (a 92 MB download can outlast a tick on slow links). Every failure is swallowed after a single `process.stderr.write('[update] ...')` line — the loop must never crash the queue processor's process. Once an update has been installed, stop checking (the next restart picks it up; repeated installs would churn the disk for no benefit).
   - Make the timer functions and the check/install functions injectable via `deps` with production defaults, following the `interruptiblePause(totalMs, isPaused, stepMs)` injectable-parameter convention in `src/commands/start.ts`, so tests drive the loop without real timers or network.

2. `src/update/auto.test.ts` (new) — with injected fake timers/stubs: dev version and `update_auto: false` never schedule; a found update calls install once, sets the store, notifies subscribers, and stops further checks; overlapping ticks are prevented by the in-flight guard; install failure leaves the store null and the loop alive.

3. `src/commands/start.ts` — in `startCommand()`, after `runQueueProcessor(config, activityBus).catch(() => { });`, add `startAutoUpdateLoop(config);`. Nothing else changes; the store-based badge needs no prop through `App`.

4. `src/tui/hooks/useInstalledUpdate.ts` (new) — `useInstalledUpdate(): string | null`; `useState(getInstalledUpdate())` initial value (covers re-mounts after an interactive subprocess) plus `useEffect` subscribing to `subscribeInstalledUpdate` and returning the unsubscribe. Follow the structure of the existing hooks in `src/tui/hooks/`.

5. `src/tui/Watch.tsx`, `src/tui/Manage.tsx`, `src/tui/Bench.tsx` — in each footer (Watch has three variants: normal ~line 233-235, compact ~line 195/222, and the paused footer via `UserPausedFooter` in `src/tui/components/WatchPaused.tsx`; Manage keybind footer ~line 428; Bench footer ~line 243), when `useInstalledUpdate()` is non-null prepend a yellow badge before the existing dim hint text: `↑ <tag> installed — restart to apply` using `yellow` from `src/tui/theme.ts`, keeping the existing `dim2`/`dim` hints intact to the right. If threading the hook into `UserPausedFooter` is disproportionate, placing the badge adjacent to it in Watch's paused branch is acceptable — but the badge must be visible in ALL of: Watch normal, Watch compact, Watch paused, Manage, and Bench.

6. `docs/DESIGN.md` — add the badge to the design spec: a short subsection under §3 (Watch anatomy, near "Bottom strip"/footer description) defining copy (`↑ vX.Y.Z installed — restart to apply`), color (yellow `#e0af68`, "needs your attention" semantics per §2.2/§2.3), placement (left of the footer keybind hints, present in every mode and every alternate state), persistence (remains until the session restarts), and trigger (background auto-update replaced the on-disk binary while this session runs the old image). Note in §4.1's footer description that the badge coexists with the paused footer.

## Code patterns to follow

- Hooks: see existing files in `src/tui/hooks/` (e.g. `useQueueState`) for naming, return shape, and effect cleanup.
- Subscription contract: `src/events/bus.ts` `subscribe` returning an unsubscribe closure.
- Footer rendering: Ink `<Box justifyContent="flex-end">` with `<Text color={...}>` segments, as in Watch.tsx line 235; colors only from `src/tui/theme.ts`, never literals in components.
- Background fire-and-forget with caught rejections, as `runQueueProcessor(...).catch(() => { })` in start.ts.
- Tests in `bun:test`; no real network, no real 6 h timers.

## Edge cases

- TUI unmount/re-render cycle (interactive subprocess hand-off): badge must reappear after re-render — covered by module-scope store + `useState` initial value.
- `update_auto: false` and dev builds: loop must not even schedule its first timer.
- Install failing halfway (network drop): original binary untouched (Phase 02 guarantee), store stays null, loop continues on schedule, single stderr line.
- A queue run executing during the swap: the on-disk rename does not affect the running process or its child harness processes; nothing must pause or interrupt the queue.
- Narrow terminals (80×24 compact mode): the badge plus hints may exceed the width; badge wins — let the dim hints truncate naturally rather than wrapping to a second line.

## Acceptance criteria

- `bun run typecheck`, `bun run lint`, and `bun test` pass.
- auto.test.ts proves: no scheduling for dev/`update_auto: false`; exactly one install per discovered update; subscriber notification; in-flight guard; checks stop after a successful install; loop survives an install failure.
- Manual smoke: `bun run src/index.ts start` launches, all three modes render their footers unchanged when no update is installed (the badge is absent, not an empty gap).
- Grep check: no color literals added to TUI components; `yellow` imported from theme.
- DESIGN.md contains the badge spec with copy, color, placement, persistence, and trigger.

## References

- `src/commands/start.ts` — `startCommand` boot order and the `interruptiblePause` injectable convention.
- `src/events/bus.ts` — subscribe/unsubscribe contract to mirror in the badge store.
- `src/tui/App.tsx` — `activityBus.subscribe` inside `useEffect` (lines 56-70) as the subscription pattern; the render loop context for why module-scope state is required.
- `src/tui/Watch.tsx` lines 195, 222, 233-235 and `src/tui/components/WatchPaused.tsx` — the footer variants to extend.
- `src/tui/theme.ts` — `yellow` (`#e0af68`) and the dim hint colors.
- docs/DESIGN.md §2.2/§2.3 (yellow semantics), §3 (Watch anatomy/footer), §4.1 (paused footer).
- `src/update/check.ts`, `src/update/install.ts`, `src/update/state.ts` — Phase 02 API.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with a conventional commit message (e.g. `feat: phase 04 — TUI auto-update loop and restart-to-apply footer badge`). Do not make intermediate commits during the phase. If you find the working tree already has a commit for this phase (check `git log --oneline -3`), skip the commit step.
