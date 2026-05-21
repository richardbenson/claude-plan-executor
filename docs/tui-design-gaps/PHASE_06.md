# Phase 6 — Modal dynamic centering

## Summary

Both modals in Manage mode use hardcoded `marginLeft` values that do not adapt to the
terminal width. Fix both to compute `marginLeft` dynamically so they are horizontally
centred regardless of terminal size.

| Modal | Width | Current `marginLeft` | Correct formula |
|---|---|---|---|
| `CommandPalette` | 80 | 20 (hardcoded) | `Math.max(0, Math.floor((columns - 82) / 2))` |
| `KillConfirmModal` | 56 | 32 (hardcoded) | `Math.max(0, Math.floor((columns - 58) / 2))` |

The width constants include the 1-cell border on each side, hence `width + 2` in the formula.

`CommandPalette` also has no height constraint. The design specifies 26 rows. Add
`height={26}` and `overflow="hidden"` so the list is clipped rather than overflowing.

## Context

`CommandPalette` is rendered in `Manage.tsx` with no `columns` prop:

```tsx
{showPalette && (
  <CommandPalette
    visible={showPalette}
    onClose={() => setShowPalette(false)}
    onRun={handlePaletteCommand}
  />
)}
```

`KillConfirmModal` is similarly rendered without `columns`:

```tsx
{killConfirm && qs.activeRun && qs.activePhase && (
  <KillConfirmModal
    runMeta={qs.activeRun}
    phaseEntry={qs.activePhase}
    elapsedMs={elapsedMs}
    onConfirm={handleKill}
    onCancel={() => setKillConfirm(false)}
  />
)}
```

Both modals need `columns` added to their props interface, and `Manage.tsx` already has
access to `columns` from its own props.

## Files expected to change

| File | Change |
|---|---|
| `src/tui/components/CommandPalette.tsx` | Add `columns` prop; dynamic `marginLeft`; `height={26}` |
| `src/tui/components/KillConfirmModal.tsx` | Add `columns` prop; dynamic `marginLeft` |
| `src/tui/Manage.tsx` | Pass `columns` to both modals |

## Edge cases

- If `columns` is very small (< 82), `marginLeft` is clamped to 0 so the modal is flush-left
  rather than clipping.
- The `height={26}` constraint on `CommandPalette` means that if the filtered command list
  is short, extra whitespace appears inside the box — this is acceptable.
- `marginTop` on both modals is kept as-is (fixed values work fine for vertical positioning).
