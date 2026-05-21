Read docs/sandbox/PHASE_03.md for full context before starting.

You are implementing Phase 3 of the CPE sandboxing plan. Phases 1 and 2 added the sandbox module
and wired injection into the queue/plan flow. This phase adds visual indicators to the TUI.

---

## Idempotency

Before editing any file, check whether the change is already present. If the sandbox glyph is
already rendered in `Manage.tsx`, skip that edit. If the "Sandbox" field is already in
`Drilldown.tsx`, skip it. Make the phase safe to resume after an interruption.

## PROGRESS.md update

At the start of this phase, update `docs/sandbox/PROGRESS.md`:
- Set phase 3 status to `in-progress`
- Fill in today's date (YYYY-MM-DD) as the started date

When all acceptance criteria are met, set status to `complete` and fill in the completed date.

---

## Before editing: read the files

Read these files in full before making any changes:

- `src/tui/Manage.tsx` — understand the QueuePane run row layout
- `src/tui/Drilldown.tsx` — understand the metadata section layout
- `src/tui/theme.ts` — understand available color tokens
- `src/types/meta.ts` — confirm `RunMeta.sandboxed?: boolean` is present

---

## 1. `src/tui/Manage.tsx` — QueuePane run row

Locate the section that renders each run row in QueuePane. The row shows a StateChip, run ID, and
plan folder name. Add a sandbox glyph at the right edge of the row when `run.sandboxed === true`.

Use `⊡` (U+22A1) as the glyph. Color it with the dim foreground color from the theme (look for
`fg3`, `comment`, `muted`, or similar — use whatever the theme file actually defines for dim text).

The glyph should be placed inside a `<Box>` with `marginLeft={1}` so it doesn't crowd the run
label. Use `<Text color={...}>⊡</Text>`.

When `run.sandboxed` is falsy (`false`, `undefined`, or `null`), render nothing — do not show a
space placeholder.

Example of what the row should look like (schematically):

```
◐  01KS3D… sandbox-plan         ⊡
●  01JX9A… other-plan
```

---

## 2. `src/tui/Drilldown.tsx` — metadata section

Locate the section that renders metadata fields (Run ID, Plan folder, Branch, Status, Cost, etc.).
After the "Status" field, add a "Sandbox" field.

Pattern to follow: look at how existing fields are rendered and match the same layout (label +
value in a `<Box flexDirection="row">`, or whatever pattern is already used).

- `run.sandboxed === true` → label `Sandbox`, value `enabled`, colored with the `complete` state
  color. Import `STATE_TABLE` from `../types/state.js` to get `STATE_TABLE.complete.color`.
- Otherwise → label `Sandbox`, value `disabled`, colored with the dim foreground color from theme.

---

## Edge cases

- `run.sandboxed` may be `undefined` for runs created before this feature was added. Treat
  `undefined` the same as `false` — show `disabled`.
- Do not change any existing layout logic. The sandbox indicator must be purely additive — no
  existing rows or fields should shift position.
- If the QueuePane row uses a fixed width or flexGrow layout, ensure the glyph does not push other
  elements out of alignment. Use `flexShrink={0}` on the glyph `<Box>` if needed.

---

## Acceptance criteria

- In Manage mode, runs with `sandboxed: true` show `⊡` on their row; others show nothing.
- In Drilldown, there is a "Sandbox" metadata field showing `enabled` or `disabled` with
  appropriate colors.
- `bun run build` succeeds with no TypeScript errors.
- Existing tests pass (`bun test`).
- No existing TUI layout is broken (existing fields remain in their correct positions).

---

## References

- `src/tui/Manage.tsx` — QueuePane run row rendering
- `src/tui/Drilldown.tsx` — metadata section
- `src/tui/theme.ts` — color tokens
- `src/types/meta.ts` — `RunMeta.sandboxed`
- `src/types/state.ts` — `STATE_TABLE` for `complete.color`

---

## One commit per phase

After all acceptance criteria are met, make exactly one commit:

```
feat: phase 03 — TUI sandbox indicator in Manage and Drilldown
```

Check `git log --oneline -3` first — if a commit for this phase already exists, skip.

---

## Structured output

Your final message must be a JSON object:

```json
{
  "completed": true,
  "committed": true,
  "commit_message": "feat: phase 03 — TUI sandbox indicator in Manage and Drilldown",
  "summary": "one or two sentence summary of what was done",
  "notes_for_next_phase": null
}
```
