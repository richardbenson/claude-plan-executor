# Phase 02 — Embedded Prompts

## Summary

Write the four embedded prompt/schema files that ship inside the `cpe` binary, plus the typed
TypeScript loader that makes them importable at runtime. These files live in `src/prompts/` and are
bundled by `bun build --compile` as static assets.

## Context

### Why embedded prompts?
`cpe` must not depend on the user having any particular skills installed in their Claude Code
config. All prompts are owned by this tool and versioned with it.

### planbot.md
Adapted from the existing planbot skill (in `~/.claude/skills/planbot/SKILL.md`), but with
critical modifications for this tool's conventions:
- **Single feature branch** — no per-phase branches, no per-phase PRs
- **One commit per phase** — each generated `PHASE_NN.prompt.md` must instruct Claude to commit
  at the end with a conventional commit message
- **Structured output** — each generated phase prompt must end with: "Your final message in this
  conversation must be a JSON object matching the schema you have been given. Do all your work
  using tools first, then emit only the JSON as your closing message."
- **Idempotency-aware** — generated phase prompts must instruct Claude to check the working tree
  state before each significant action so the phase is safe to resume after a rate-limit
  interruption
- **Update PROGRESS.md** — generated phase prompts instruct Claude to update `PROGRESS.md` (the
  tool treats it as cosmetic, but it's useful for humans browsing the repo)
- Plans go in `docs/<folder>/`; the folder name is chosen by planbot based on the plan content.

### summarise.md
Adapted from the summarise-plan skill. Used headless (`claude -p`). The tool injects the folder
name as a parameter. Must: read all files in `docs/<folder>/`, write `docs/<folder>.md`, delete
`docs/<folder>/`.

### bootstrap-detect.md
One-shot LLM prompt. Instructs Claude to inspect the repo for `README.md`, `CLAUDE.md`,
`AGENTS.md`, `QUICK_START.md`, `CONTRIBUTING.md`, `Makefile`, and package manifests at root and
one level deep, then propose bootstrap commands. Claude returns structured JSON matching the schema
in §6.1 of the spec (commands, inspected_files, reasoning, blockers).

### phase-result-schema.json
The JSON Schema passed to every phase invocation via `--json-schema`. Schema validates:
- `completed` (bool): phase goal fully achieved
- `committed` (bool): a git commit was made
- `commit_message` (string|null): the commit message used
- `summary` (string, max 500 chars): human-readable description
- `blockers` (array of strings): anything that prevented completion
- `notes_for_next_phase` (string): info for the next phase

### src/prompts/index.ts
A typed loader. Uses `Bun.file()` (or `import` with `with { type: 'text' }`) to read each prompt
file at runtime. Exports typed constants so other modules import prompts without path strings.

## Files Expected to Change

- `src/prompts/planbot.md` — created
- `src/prompts/summarise.md` — created
- `src/prompts/bootstrap-detect.md` — created
- `src/prompts/phase-result-schema.json` — created
- `src/prompts/index.ts` — created

## Acceptance Criteria

1. All four prompt/schema files exist and are non-empty
2. `planbot.md` contains the single-branch, commit-per-phase, structured-output, idempotency
   modifications versus the base planbot skill
3. `phase-result-schema.json` is valid JSON Schema with all required fields from §7.3.1 of the
   spec
4. `src/prompts/index.ts` exports typed references to all four files; `tsc --noEmit` passes

## Dependencies

Phase 01 (project skeleton, TypeScript configured, Bun available).
