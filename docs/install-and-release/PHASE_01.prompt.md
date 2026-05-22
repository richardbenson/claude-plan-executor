Read docs/install-and-release/PHASE_01.md for full context before starting.

You are implementing Phase 01 of the install-and-release plan: version embedding. The goal is to replace the hardcoded version string in the CLI with a build-time injectable constant sourced from `process.env.CPE_VERSION`, falling back to `'dev'` when not set.

**Idempotency**: Before each significant action (creating a file, making a commit), check the working tree state first — does the file already exist? Is this already committed? Are the tests already passing? This makes the phase safe to resume after a rate-limit interruption.

**PROGRESS.md update**: At the start of this phase, update `docs/install-and-release/PROGRESS.md`: set the status for Phase 01 to `in-progress` and fill in the started date. When the phase is complete, set the status to `complete` and fill in the completed date. Use today's date in YYYY-MM-DD format.

**One commit per phase**: At the end of the phase, after all acceptance criteria are met, make exactly one git commit with message `feat: phase 01 — version embedding`. Do not make intermediate commits. If `git log --oneline -3` already shows a commit for this phase, skip the commit step.

---

## Work to do

### 1. Create `src/version.ts`

Create the file with this exact content:

```ts
export const CPE_VERSION: string = process.env.CPE_VERSION ?? 'dev';
```

### 2. Update `src/cli.ts`

In `src/cli.ts`, the `setupCli` function calls `program.version('0.1.0')` on line 31. Replace this with:

```ts
import { CPE_VERSION } from './version.js';
// ...
program.version(CPE_VERSION);
```

Add the import at the top of the file alongside the other imports. Replace the string literal `'0.1.0'` with the imported constant.

### 3. Verify

Run `bun run typecheck` — it must pass with no errors.

Run `bun test` — all tests must pass.

Run `bun run build` then `./cpe --version` — it must print `dev`.

Optionally verify the define flag works:
```
bun build --compile --define 'process.env.CPE_VERSION="v1.2.3"' --outfile cpe-test src/index.ts && ./cpe-test --version
```
It must print `v1.2.3`. Clean up `cpe-test` afterwards.

---

## Acceptance criteria

- `src/version.ts` exists and exports `CPE_VERSION`
- `src/cli.ts` imports `CPE_VERSION` from `./version.js` and passes it to `program.version()`
- No hardcoded version string remains in `src/cli.ts`
- `bun run typecheck` passes
- `bun test` passes
- `./cpe --version` prints `dev` after a plain `bun run build`

---

**Structured output**: Your final message in this conversation must be a JSON object matching the schema you have been given. Do all your work using tools first, then emit only the JSON as your closing message.
