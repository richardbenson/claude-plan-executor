# Phase 05 - Matrix / bench command + summary table

## Summary
Add a command that enqueues the **harness x model cross-product** of a single prompt as ordinary cpe
runs, and a summary table over the captured results. The matrix is just bulk-enqueueing parameterized
runs from Phase 01-04.

## Context
- Runs are enqueued via `src/storage/queue.ts` (`AppQueue`/`QueueEntry`) and processed by
  `src/commands/start.ts`. A single-prompt run already carries `prompt`, and now `harness`/`model`/
  `provider` (Phase 01). Capture writes `results/<harness>__<model>/meta.json` (Phase 04).
- The prompt is a runtime input (locked decision) - the matrix command takes it as arg/stdin/file.

## Approach
- `src/commands/bench.ts` (new): `cpe bench` takes a prompt (args, stdin, or `--prompt-file`), a list
  of harnesses (`--harness a,b,c`), a list of models (`--model x,y`), a `--provider`, plus optional
  `--repo` and `--branch` overrides. The repo/branch **default to the baseline detected from the CWD**
  (`getPrimaryRepo()` + `getCurrentBranch()`, the same as the plan tool and Phase 04) - there is no
  hardcoded repo or `modeltests/sandbox-no-docs` default. It enqueues one run per (harness, model) with
  `isolation: 'clone'`, named `<harness>__<model>`. Sequential by existing queue semantics.
- `src/commands/bench.ts` also provides `cpe bench summary` (or a `--summary` flag): read all
  `results/*/meta.json` and print a table (harness, model, outcome, wall-clock, files/lines changed,
  tokens/cost, branch). Reuse the table style in `src/commands/list.ts`/`status.ts`.

## Files expected to change
- `src/commands/bench.ts` (new) - matrix enqueue + summary
- `src/cli.ts` - register the `bench` command
- `src/storage/queue.ts` - only if cross-product enqueue needs a small helper
- (read-only) `src/runner/capture.ts` meta.json shape from Phase 04
