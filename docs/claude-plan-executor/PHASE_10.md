# Phase 10 — TUI Shell + Shared Primitives

## Summary

Build the Ink application shell and all shared primitive components (theme, state table lookup,
spinner, sparkline, state chip, header row). After this phase `cpe start` renders a real Ink UI
that reacts to terminal dimensions, though Watch/Manage content is placeholder. The queue processor
from Phase 09 continues to run in parallel — the TUI is layered on top.

## Context

Read `docs/DESIGN.md` in full before writing any component. It is the source of truth for layout,
colour, state mapping, and keybinds.

### src/tui/theme.ts
Export all Tokyo Night colour tokens as typed string constants. Match the hex values in
`docs/DESIGN.md §2.2` exactly. Token names must match the names used in the design doc (e.g.
`bg`, `bgFloat`, `bgHi`, `border`, `borderHi`, `dim`, `dim2`, `fgMute`, `fgDark`, `fg`, `blue`,
`cyan`, `cyan2`, `teal`, `green`, `green2`, `yellow`, `orange`, `red`, `magenta`).

### src/tui/state.ts
The `STATE_TABLE` imported from `src/types/state.ts` (Phase 03) contains glyph/color/label per
state. This module is a thin re-export with any TUI-specific helpers needed by components:
- `getStateStyle(status: RunStatus | PhaseStatus): { glyph: string; color: string; label: string }`

### src/tui/components/StateChip.tsx
`<StateChip status={status} />` renders `<glyph> <label>` with the correct Ink color.

### src/tui/components/Spinner.tsx
`<Spinner />` wraps `ink-spinner` with the `dots` preset (the `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` cycle per
DESIGN.md §8). Color: `cyan`.

### src/tui/components/Sparkline.tsx
`<Sparkline data={number[]} width={number} color={string} />`
Uses eighth-block glyphs `▁▂▃▄▅▆▇█`. Normalize `data` to [0, 7], map to the glyph at that index,
truncate or pad to `width`. If data is empty, render `width` spaces.

### src/tui/components/Header.tsx
`<Header mode={'WATCH' | 'MANAGE'} status={RunStatus | null} elapsed={number | null} />`
Renders row 0 of DESIGN.md: `▮ cpe · <MODE> · <status_text>` on the left,
`<datetime> BST` on the right. Color the mode label appropriately (teal for WATCH, orange for
MANAGE per DESIGN.md). The status text is a short phrase like "queue chewing ●".

### src/tui/App.tsx
Root Ink component. Responsibilities:
1. `useStdoutDimensions()` to get terminal width/height; pass down as context
2. Read mode from state: `'watch' | 'manage'`; default `'watch'`
3. `useInput` to handle `v` (toggle mode) and `q` (quit — show confirmation if session active)
4. Render `<Header />` at the top
5. Render `<Watch />` or `<Manage />` depending on mode (both are stubs in this phase — just
   render a placeholder `<Text>` saying "Watch mode coming in Phase 11")
6. Event bus subscription: subscribe to `activityBus` on mount, store events in local state,
   unsubscribe on unmount

### Integration: wiring TUI to cpe start
Update `src/commands/start.ts` from Phase 09:
- Import `render` from `ink`
- Before starting the queue processor loop, call `render(<App />)`
- The queue processor runs as a normal async function alongside the Ink render loop (Ink handles
  its own event loop internally; just `await startQueueProcessor(...)` after render)
- Remove the `console.log` progress lines added in Phase 09 (the TUI handles display now)

## Files Expected to Change

- `src/tui/theme.ts` — created
- `src/tui/state.ts` — created
- `src/tui/components/StateChip.tsx` — created
- `src/tui/components/Spinner.tsx` — created
- `src/tui/components/Sparkline.tsx` — created
- `src/tui/components/Header.tsx` — created
- `src/tui/App.tsx` — created
- `src/commands/start.ts` — updated to render the Ink app

## Acceptance Criteria

1. `tsc --noEmit` passes
2. `bun run build` produces a binary that, when run as `./cpe start`, renders the Ink TUI
   without crashing (placeholder content is fine)
3. `v` key toggles between "Watch mode" and "Manage mode" placeholder screens
4. `q` key exits the TUI cleanly (with confirmation dialog if a session were active — stub: just
   prompt "Really quit? [y/N]" for now)
5. Terminal resize is handled without crashing (test by resizing the terminal window)
6. `<Sparkline data={[0,1,2,3,4,5,6,7]} width={8} color="green" />` renders `▁▂▃▄▅▆▇█`

## Dependencies

Phase 09 (queue processor and full runner exist; start.ts is ready to be updated).
