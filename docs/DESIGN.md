# Coding Plan Executor — TUI Design Spec

> Source-of-truth design doc for the `cpe` TUI. Pair with the visual reference (`tui-design.html` — open in a browser) for layout intuition.

This doc is written for a Claude Code session driving implementation. It is denser than a normal design doc because it's meant to translate directly into Ink components.

---

## 1. Two modes, one tool

`cpe` has **two modes** that share the same data and primitives but optimise for very different attention budgets. Toggle with `v`.

| Mode | When | What it looks like |
|---|---|---|
| **Watch** *(passive)* | Side monitor; overnight; "is it still chewing?" | Big readable type, calm chrome, almost no keybinds. Hero is what's running NOW. Below it: live activity feed, up-next, limit window, today's tally. |
| **Manage** *(active)* | At keyboard; reordering queue; deciding what to retry | Dense triptych: queue · phases · live session. Visible selection state. Every operation has a keybind in the contextual command bar. |

**`cpe start` always launches in Watch.** Manage is opt-in via `v`.

---

## 2. Visual system

### 2.1 Type

- **Font**: JetBrains Mono (or the user's terminal default — Ink doesn't get to choose, but the design assumes monospace).
- **Cell**: 1 ch × 1 line. All positioning is cell-aligned.
- **Big numbers** (phase counter, limit countdown) are rendered in a larger pixel-sized type within the cell grid — this is the only place we break monospace alignment, intentionally, for legibility from across the room.

### 2.2 Color (Tokyo Night)

| Token | Hex | Role |
|---|---|---|
| `bg` | `#1a1b26` | terminal background |
| `bgFloat` | `#1f2335` | row highlight, modal cards |
| `bgHi` | `#292e42` | selection highlight |
| `border` | `#3b4261` | box borders (resting) |
| `borderHi` | `#414868` | divider rules (`·`) |
| `dim` | `#565f89` | labels, secondary text |
| `dim2` | `#737aa2` | mid-emphasis text |
| `fgMute` | `#9aa5ce` | body text (de-emphasised) |
| `fgDark` | `#a9b1d6` | body text |
| `fg` | `#c0caf5` | primary text |
| `blue` | `#7aa2f7` | brand / "cpe" wordmark |
| `cyan` | `#7dcfff` | **executing**, focused pane, active selection |
| `cyan2` | `#2ac3de` | accents (header for non-focused active info) |
| `teal` | `#73daca` | Watch-mode header accent |
| `green` | `#9ece6a` | **complete**, OK, "live" indicator |
| `green2` | `#41a6b5` | commit SHAs, PR-open |
| `yellow` | `#e0af68` | **budget**, **user-paused** |
| `orange` | `#ff9e64` | **retrying**, Manage-mode header accent |
| `red` | `#f7768e` | **failed**, destructive confirmations |
| `magenta` | `#bb9af7` | **paused-limit** (5h window), countdowns |

**Rule**: saturated hues are never decorative. They map 1:1 to a state, a focus position, or a destructive action.

### 2.3 State taxonomy

The single source of truth for run/phase status. Every screen draws state with the same glyph + colour.

| State | Glyph | Color | Label | Meaning |
|---|---|---|---|---|
| `queued` | `○` | `dim2` | "queued" | Waiting in line |
| `executing` | `◐` | `cyan` | "executing" | Claude session running |
| `retrying` | `↻` | `orange` | "retrying" | Phase failed once, on second attempt |
| `paused` | `⏸` | `yellow` | "paused" | User-initiated pause |
| `paused-limit` | `◴` | `magenta` | "limit-wait" | Waiting on 5h window |
| `finalising` | `⤴` | `teal` | "finalising" | Running `summarise` + creating PR |
| `complete` | `●` | `green` | "complete" | All phases done |
| `pr-created` | `✓` | `green` | "PR opened" | Push + PR done |
| `failed` | `✕` | `red` | "failed" | Phase failed after retries exhausted |
| `pending` | `·` | `dim` | "pending" | Phase not yet reached |

---

## 3. Watch (passive) — anatomy

**Default mode on launch. Target size: 120×40.**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▮ cpe · WATCH · queue chewing ●                today · active 4h 26m     │  row 0
├──────────────────────────────────────────────────────────────────────────┤
│ ╭────────── HERO (rows 2-13) ────────────────────────────────────────╮  │
│ │ NOW EXECUTING                              today's progress         │  │
│ │ meatbot / 001-add-tests                    14 phases complete       │  │
│ │                                                                     │  │
│ │ phase 04 / 14 — Login failure & lockout tests   budget today        │  │
│ │                                                  $9.74 across 4 runs │  │
│ │ plan ████████████░░░░░░░░░░░░░░░░░░░░░░░░  cost/hour ▁▂▃▄▅▆▇█       │  │
│ ╰─────────────────────────────────────────────────────────────────────╯  │
│                                                                          │
│ LIVE ACTIVITY ● streaming session a7f3b2…                                │
│ ····················································                     │
│ 02:47:14  ✎ edit    src/auth/lockout.ts +18 −3 · writing █              │
│ 02:46:52  $ bash    pnpm vitest run tests/login → 20 passed (1.04s)     │
│ 02:46:23  ✎ edit    src/auth/login.ts +12 −4                            │
│ 02:45:08  ▸ phase   started phase 04 — Login failure & lockout tests   │
│ 02:44:51  ◆ commit  c3e7841 · test(auth): cover login happy-path        │
│ 02:44:32  ✓ ok      phase 03 complete — 8 tests added · $0.09           │
│ ...                                                                      │
├──────────────────────────────────────────────────────────────────────────┤
│ UP NEXT          LIMIT WINDOW                  TODAY                     │
│ 02 ○ meatbot...  2h 14m until reset            ✓ 14  phases done         │
│ 03 ○ bird-dt...  ▰▰▰▰▰▰▱▱▱▱▱▱▱▱  38% used     ◆ 5   commits pushed      │
│ 04 ○ gitea-p...  resets 5:00am Europe/London   ▸ 2   PRs opened          │
│ queue ETA 05:21  tokens this window  ▁▂▃▅▇█    ↻ 1   phase retried       │
│                                                ✕ 0   failures            │
├──────────────────────────────────────────────────────────────────────────┤
│ tue 17 may · 02:47:18 BST                     v manage  q quit           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Activity feed kinds

| Kind | Glyph | Color | Source |
|---|---|---|---|
| `phase` | `▸` | cyan | Run state transition (start of phase) |
| `edit` | `✎` | magenta | `Edit` / `Write` tool from envelope |
| `bash` | `$` | green | `Bash` tool from envelope |
| `commit` | `◆` | green2 | New HEAD detected after phase |
| `ok` | `✓` | green | Phase completed (envelope `completed: true`) |
| `pause` | `‖` | yellow | User pressed `p` |
| `error` | `✕` | red | Phase failed |
| `limit` | `◴` | magenta | 429 hit |

Feed is in-memory only (TUI lifetime). Most recent on top. Truncate at the top of the visible area.

### Right hero column

Stats that DON'T change while the current phase runs go here:
- Today's progress (phases completed today across all runs)
- Today's budget (sum of `total_cost_usd` across today's runs)
- Cost/hour sparkline (last 18h, per-hour cumulative)

### Bottom strip

Three blocks of equal width:
1. **Up next** — next 3 queued runs + total queue ETA (sum of run ETAs)
2. **Limit window** — countdown + percentage + sparkline of token use in current 5h window
3. **Today** — terse counters (phases done, commits, PRs, retries, failures)

---

## 4. Watch — alternate states

### 4.1 Queue paused by user (`p` from Manage)

Visually: yellow takes over.
- Header banner background → `rgba(224,175,104,0.12)` strip on row 0
- Header copy → `‖‖ QUEUE PAUSED · by user · 2m ago`
- Hero box border → yellow
- Hero left copy → "FINISHING THIS PHASE, THEN STOPPING"
- Right hero column → "queued behind: N runs · M phases waiting · none will start while paused"
- Up-next rows → each gets a `‖ paused` tag
- Limit window → "continues counting down while paused"
- Footer → yellow `‖ queue paused · no runs will start until resumed` + `v manage  q quit`

### 4.2 Queue paused on 5h limit (auto)

This is **structurally different** from user-pause — the screen reshapes. The countdown becomes the hero.
- Header → `WATCH · queue paused · waiting on 5h limit window`
- Hero (full width, rows 2-15) → magenta border, contains:
  - Left: huge `2h 14m` countdown (72px), "WAITING FOR WINDOW RESET" label, "resumes at 5:00am Europe/London"
  - Right: "window usage 100%", filled progress bar, tokens-this-window sparkline, "api_error_status: 429" diagnostic
- Below: "WHAT'S WAITING" list (the paused run + queued runs)
- Right: TODAY tally (same as default Watch)
- "WHILE YOU WAIT" hint block at the bottom explaining auto-resume behavior

---

## 5. Manage (active) — anatomy

**Opt-in via `v`. Target size: 120×40.**

Three columns:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▮ cpe · MANAGE · press v for watch mode    ● live · queue running 4h 26m │  row 0
├──────────────────────────────────────────────────────────────────────────┤
│╭ QUEUE · 7 ─╮ ╭ PHASES · selected run ───────╮ ╭ EXECUTING · meatbot ──╮│
││▶ meatbot   │ │ ○ 01 Set up Ultralytics...   │ │ Login failure tests   ││
││  /001-add  │ │ ○ 02 Convert weights → ONNX  │ │ session a7f3b2…       ││
││  ◐ exec    │ │ ○ 03 Detection pipeline...   │ │ ····················  ││
││  04/14 ━━━ │ │ ○ 04 Confidence sweep        │ │ TOOL CALLS          7 ││
││            │ │ ...                          │ │ ✓ Read login.ts  4ms  ││
│││ bird-det  │ │                              │ │ ✓ Edit ...spec.ts  6ms││
│││ /001-yolo │ │                              │ │ ...                   ││
│││ ○ queued  │ │                              │ │ ⠋ Edit lockout.ts     ││
│││ 00/11     │ │                              │ │                       ││
││   ↑ SELECTED                                │ │ tokens 4.2k + 33k     ││
││ ...                                         │ │ cost   $0.187 phase   ││
│╰────────────╯ ╰──────────────────────────────╯ ╰───────────────────────╯│
├──────────────────────────────────────────────────────────────────────────┤
│ selected  bird-detector · 001-yolov8-port · queued · 3rd · eta ~4h       │  status line
│ QUEUE  ↑↓ select  ⌥↑↓ reorder  ↵ phases  p pause  r remove  a add plan   │
│ RUN    R retry phase  S skip phase  K kill session  e $EDITOR  : palette │
└──────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Selection model

- **`sel` cursor** is independent of the executing run.
- The cursor lives in the **focused pane** (the one with `cyan` border).
- Selected row gets:
  - `bgFloat` background fill across the row group (3 lines for queue, 1 for phases)
  - Left edge marker: `┃` in cyan on every row of the selection
  - First-line label bolded
- `Tab` cycles pane focus: queue → phases → executing.
- `↑↓` moves the cursor within the focused pane.
- `↵` on a queue row opens the phases pane for that run.
- `↵` on a phase row opens the **drilldown view** (§6).

### 5.2 Keybinds

The command bar is split into two contextual rows:

**QUEUE row** — operations on the cursor's queue selection:
- `↑↓` move selection
- `⌥↑↓` reorder selected run up/down in queue
- `↵` open phases for selected run
- `p` pause/resume the entire queue
- `r` remove selected run (prompts: keep worktree or delete)
- `a` add plan — opens inline `cpe queue` flow

**RUN row** — operations on the currently-executing run:
- `R` retry current phase (kills session, restarts phase)
- `S` skip current phase (mark complete: false, committed: false, advance)
- `K` kill session — opens confirmation modal (§5.5)
- `e` open worktree in `$EDITOR`
- `l` tail phase log in `$PAGER`
- `:` open command palette (§5.4)
- `q` quit (confirms if a session is active)

### 5.3 Status line (row 36)

Always shows what `selected` refers to:
```
selected  <name>/<plan> · <state> · <position> · eta <eta>
          worktree <id> · <disk size>
```

### 5.4 Command palette (`:`)

Modal overlay. Dim everything underneath (35% opacity).
- Centred 80×26 card, cyan border, `bgFloat` background
- Top line: `: <query>█` with a blinking cursor
- Below: filtered command list. Each row:
  - `cat` label (run / queue) in category colour
  - command name
  - one-line description in `dim2`
- `↑↓` to select, `↵` to run, `esc` to dismiss
- Selected row gets a `bgHi` highlight + `▶` marker

Commands include all keybinds above plus:
- `remove run + worktree` (vs `r` which keeps the worktree)
- `open PR` (when the selected run is finalised)
- `open worktree` (in `$EDITOR`)
- `tail phase log`

### 5.5 Kill confirmation (`K`)

Modal: red bordered card (56×14) titled `⚠ KILL SESSION`. Body:
```
Force-kill the running phase?

run     meatbot · 001-add-tests
phase   04 · Login failure & lockout tests
session a7f3b2c1-9e4d-…
elapsed 14m 22s · $0.187 spent so far

This will:
  · send SIGTERM to claude, then SIGKILL after 5s
  · mark phase 04 failed, do NOT retry
  · pause the run; queue advances to next

                              [n] cancel    [K] kill
```

### 5.6 Manage — queue paused (`p`)

Yellow banner spans rows 0-1 (full width).
- `‖‖ QUEUE PAUSED · currently-executing phase finishes, then waits · paused 2m ago · press p to resume`
- Phases pane greyed out with caption "queue paused — these phases will not start"
- Executing pane carries "‖ this phase will finish · queue won't advance"
- Status line gets `‖ paused` after the queue position
- Keybind row's `p pause` → `p RESUME` (visually emphasised)

---

## 6. Phase drilldown (`↵` on a phase row)

Full-screen view. Phase list on left (col 0-47), selected phase's report on right (col 49-119).

Right pane contains:
1. **Metadata**: status chip, commit SHA, retry count, duration, cost, token total, session UUID
2. **Summary** (from `structured_output.summary`)
3. **Commit message** (from `structured_output.commit_message` + parsed git log body)
4. **Notes for next phase** (from `structured_output.notes_for_next_phase`)
5. **Session log** (top-15 lines of the per-call timeline derived from the jsonl)
6. **Stdout tail** (last 3 lines of `phase-NN.log`)

Keybinds: `↑↓` next/prev phase · `l` pager log · `e` edit in $EDITOR · `r` retry · `s` skip · `d` show diff · `esc` back to main view.

---

## 7. Responsive sizing

### 7.1 80×24 (compact)

- Single pane at a time (queue OR active), `Tab` to swap.
- No dashboard cards; metrics collapse to two short lines inside the active pane.
- Header drops version + datetime, keeps `▮ cpe` + active run identity.
- Footer collapses to one row of keybinds.

### 7.2 120×40 (default)

- The canonical layout above. Watch + Manage both designed for this size.

### 7.3 160×50 (roomy)

- Watch: hero gets a "today" stat card row above the activity feed.
- Manage: dashboard cards (Active / Budget / Limit / Queue) sit above the triptych, all visible simultaneously. Phase list is wider; log preview is full height.

---

## 8. Ink implementation notes

- One root `Box` per viewport, fixed `width`/`height` set from `useStdoutDimensions()`.
- Each pane is a `Box` with `borderStyle="round"` and `borderColor` driven by focus state.
- State icons + colors live in a single `state.ts` table — every component reads from it.
- Selection highlight is a `Box` with `backgroundColor={bgFloat}` wrapping the row — Ink doesn't have a "selected row" primitive; we synthesise one.
- Big-number rendering: don't try to do it in Ink. Use **figlet/cfonts** to render glyphs into a small ASCII block (the `2h 14m` countdown and `04 / 14` phase counter both render fine at figlet's "small" font in 3 rows). Drop into a `<Text>` block at the right cell position.
- Sparklines: standalone `Sparkline` component, uses the eighth-block glyphs `▁▂▃▄▅▆▇█`.
- Spinner: `ink-spinner` `dots` preset is the `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` cycle — matches the design.
- Activity feed is a controlled `<Static>` for already-emitted entries + a `<Text>` for the live row, so React only re-renders the live row each tick.

---

## 9. Glossary

- **Run** — a queued plan being executed
- **Phase** — a single `PHASE_NN.prompt.md`, one Claude session, one commit
- **Worktree** — the per-run `git worktree` at `~/.local/state/cpe/worktrees/<run-id>/`
- **Limit window** — the rolling 5h window in which Claude session credits are consumed
- **Envelope** — the JSON blob `claude -p --output-format=json` returns when the session ends
- **Structured output** — the `structured_output` key inside the envelope, validated against the phase result schema (§7.3.1 of the master spec)
