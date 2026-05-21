Read docs/cpe-system-test/PHASE_03.md for context before starting.

**Idempotency**: Before each significant action (creating a file, running a migration, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after a rate-limit interruption.

**PROGRESS.md update**: At the start of this phase, update `docs/cpe-system-test/PROGRESS.md`: set the status for Phase 3 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with message: `feat: phase 03 — read line 47 of spec`. Do not make intermediate commits. If you find the working tree already has a commit for this phase (check `git log --oneline -3`), skip the commit step.

**Structured output**: Your final message in this conversation must be a JSON object matching the schema you have been given. Do all your work using tools first, then emit only the JSON as your closing message.

---

## Task

Read line 47 of `docs/000-claude-plan-executor-spec.md`. Output that line as your summary in the structured output.

## Acceptance criteria

1. `docs/cpe-system-test/PROGRESS.md` shows Phase 3 as `complete` with today's date in both Started and Completed.
2. A commit exists with message `feat: phase 03 — read line 47 of spec`.
3. The `summary` field of your structured output contains the text of line 47 verbatim.
