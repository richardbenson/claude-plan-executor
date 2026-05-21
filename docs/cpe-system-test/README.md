# CPE System Test

A smoke-test plan for the Claude Plan Executor system. Each phase reads one line from `docs/000-claude-plan-executor-spec.md` and outputs it as its result. No application code is modified.

## Documents

- [PROGRESS.md](PROGRESS.md) — phase tracking table
- [PHASE_01.md](PHASE_01.md) / [PHASE_01.prompt.md](PHASE_01.prompt.md)
- [PHASE_02.md](PHASE_02.md) / [PHASE_02.prompt.md](PHASE_02.prompt.md)
- [PHASE_03.md](PHASE_03.md) / [PHASE_03.prompt.md](PHASE_03.prompt.md)
- [PHASE_04.md](PHASE_04.md) / [PHASE_04.prompt.md](PHASE_04.prompt.md)

## Definition of Done

- All 4 phases complete successfully
- Each phase's git commit message contains the line it read from the spec
- `PROGRESS.md` shows all 4 phases as `complete`
