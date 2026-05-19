Read docs/claude-plan-executor/PHASE_02.md for full context before starting.

You are implementing phase 02 of the Claude Plan Executor (`cpe`) project. This phase writes the
four embedded prompt/schema files that ship inside the binary, plus their TypeScript loader.

Working directory: /home/ubuntu/Code/claude-plan-executor
Branch: feature/claude-plan-executor-phase-2 (create it off feature/claude-plan-executor)
PR target: feature/claude-plan-executor

Before writing anything, read:
- docs/000-claude-plan-executor-spec.md §4.1 (embedded prompts — what each must do)
- docs/000-claude-plan-executor-spec.md §7.3.1 (phase result schema)
- docs/000-claude-plan-executor-spec.md §6.1 (bootstrap-detect schema)
- ~/.claude/skills/planbot/SKILL.md (the base planbot skill to adapt for planbot.md)

FILES TO CREATE:

src/prompts/planbot.md — A planning agent system prompt, adapted from the planbot skill with these
mandatory modifications for cpe's conventions:

SINGLE BRANCH MODEL: Generated plans use a single feature branch (feature/<folder>) with no
per-phase sub-branches and no per-phase PRs. Remove all mentions of phase branches from the
branching strategy section.

ONE COMMIT PER PHASE: Each generated PHASE_NN.prompt.md must instruct Claude to make exactly one
git commit at the end of the phase with a conventional commit message. Add this to the PHASE_XX
prompt template section.

STRUCTURED OUTPUT: Each generated PHASE_NN.prompt.md must end with this instruction (verbatim):
"Your final message in this conversation must be a JSON object matching the schema you have been
given. Do all your work using tools first, then emit only the JSON as your closing message."

IDEMPOTENCY: Each generated PHASE_NN.prompt.md must instruct Claude to check the working tree
state before each significant action (file exists? already committed? tests already passing?) so
the phase is safe to resume after a rate-limit interruption. Add this as a standing instruction.

PROGRESS.md UPDATE: Each generated PHASE_NN.prompt.md must instruct Claude to update PROGRESS.md
when the phase starts (set status in-progress) and again when it completes (set status complete
with date). This is cosmetic — the tool's meta.json is authoritative — but useful for humans.

Otherwise keep the planbot skill's structure: requirements gathering, refinement, work splitting,
documentation (README.md, PROGRESS.md, PHASE_NN.md, PHASE_NN.prompt.md).

src/prompts/summarise.md — A non-interactive summarise prompt. The tool injects the folder name
before spawning. The prompt should instruct Claude to:
1. Read all files in docs/<FOLDER>/ (README.md, PROGRESS.md, all PHASE_NN.md and
   PHASE_NN.prompt.md files)
2. Read git log --oneline for the feature branch to see what was actually committed
3. Write docs/<FOLDER>.md with: original requirements summary, what was built phase by phase,
   any deviations from the plan, lessons learned, final PR link if known
4. Delete the docs/<FOLDER>/ directory entirely (rm -rf equivalent using Bash tool)
5. Emit no structured JSON — this runs as a plain headless claude -p session

The folder name is injected by cpe as a literal substitution of the string PLAN_FOLDER in the
prompt before passing it to Claude. Use PLAN_FOLDER as the placeholder.

src/prompts/bootstrap-detect.md — A one-shot prompt for inspecting a repo and proposing bootstrap
commands. Instruct Claude to:
1. Read README.md, CLAUDE.md, AGENTS.md, QUICK_START.md, CONTRIBUTING.md (if they exist)
2. Read package.json, Cargo.toml, pyproject.toml, composer.json, go.mod, Gemfile at root and
   one directory deep
3. Read Makefile at root if present
4. Based on what it finds, propose an ordered array of shell commands needed to set up a fresh
   worktree (install deps, build native modules, etc.)
5. Return ONLY valid JSON matching the schema (commands array, inspected_files array, reasoning
   string, blockers array). No prose, no code fences, just raw JSON.
The tool uses --json-schema with this prompt so Claude's output must be schema-valid JSON.

src/prompts/phase-result-schema.json — Valid JSON Schema for the structured output that every
phase session must emit. Required fields: completed (boolean), committed (boolean), summary
(string, maxLength 500). Optional fields: commit_message (string or null), blockers (array of
strings), notes_for_next_phase (string). Set "additionalProperties": false and "type": "object".
Match the schema in docs/000-claude-plan-executor-spec.md §7.3.1 exactly.

src/prompts/index.ts — Typed loader. Use Bun.file().text() to read each prompt file relative to
import.meta.dir. Export typed constants:
  export const PLANBOT_PROMPT: string
  export const SUMMARISE_PROMPT: string
  export const BOOTSTRAP_DETECT_PROMPT: string
  export const PHASE_RESULT_SCHEMA: string  (raw JSON string)
  export const PHASE_RESULT_SCHEMA_PATH: string  (absolute path for passing as --json-schema)

For the schema path, use the resolved absolute path so it can be passed directly to `claude -p
--json-schema <path>` without needing to write it to a temp file.

VERIFY before committing:
1. bun run typecheck passes
2. src/prompts/phase-result-schema.json is valid JSON (verify by parsing it in Node/Bun)
3. planbot.md contains the words "structured output", "idempotent", and "one commit per phase"
   (or equivalent phrasing)
4. PLANBOT_PROMPT in index.ts resolves to a non-empty string at runtime

After all criteria pass:
1. git add src/prompts/
2. git commit -m "feat: phase 02 — embedded prompts and schema"
3. git push -u origin feature/claude-plan-executor-phase-2
4. Create PR: gh pr create --base feature/claude-plan-executor --title "Phase 02: Embedded prompts" --fill

Update docs/claude-plan-executor/PROGRESS.md: mark phase 02 in-progress on start, complete on
finish with today's date.

Your final message in this conversation must be a JSON object matching the schema you have been
given. Do all your work using tools first, then emit only the JSON as your closing message.
