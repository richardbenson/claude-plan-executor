Read docs/claude-plan-executor/PHASE_01.md for full context before starting.

You are implementing phase 01 of the Claude Plan Executor (`cpe`) project — a TypeScript + Bun +
Ink CLI/TUI tool. This phase bootstraps the project from scratch: package manager, TypeScript,
Ink, ESLint, bun test, and the binary build pipeline.

Working directory: /home/ubuntu/Code/claude-plan-executor
Branch: feature/claude-plan-executor-phase-1 (create it off feature/claude-plan-executor)
PR target: feature/claude-plan-executor

CONVENTIONS — all later phases follow these; establish them here:
- Named exports only (no default exports)
- Single quotes for strings
- Semicolons at end of statements
- File naming: kebab-case (reset-time.ts, not resetTime.ts)
- Directory naming: lowercase (src/runner/, src/tui/)
- Error handling: throw typed Error subclasses; do not silently swallow errors
- No `any` types — use `unknown` and narrow
- JSX files: .tsx extension only; all other TypeScript: .ts

FILES TO CREATE:

package.json — Bun project. Required production dependencies: ink (v5+), react, ink-spinner,
commander, ulid. Dev dependencies: typescript, @types/react, @types/bun, eslint,
@typescript-eslint/eslint-plugin, @typescript-eslint/parser. Scripts: "build" runs
`bun build --compile --outfile cpe src/index.ts`, "typecheck" runs `tsc --noEmit`, "lint" runs
`eslint src --ext .ts,.tsx`, "test" runs `bun test`. Set `"name": "cpe"` and `"version": "0.1.0"`.
Do not add a `"main"` field — this is a compiled binary, not a library.

tsconfig.json — Strict TypeScript compatible with Bun and Ink. Key settings:
- "target": "esnext"
- "module": "esnext"
- "moduleResolution": "bundler" (required for Bun)
- "jsx": "react-jsx"
- "jsxImportSource": "react"
- "strict": true
- "noUncheckedIndexedAccess": true
- "noImplicitAny": true
- "esModuleInterop": true
- "skipLibCheck": true
- "outDir": "./dist"
- "include": ["src"]

.gitignore — Standard: node_modules/, dist/, cpe (the compiled binary output), *.log, .env.
Keep bun.lockb tracked (do NOT add it to .gitignore).

bunfig.toml — Minimal build config. Set [build] target = "bun".

eslint.config.ts — Flat config (ESLint v9). Import @typescript-eslint/eslint-plugin and the
recommended config. Set parser to @typescript-eslint/parser. Set parserOptions.project to
./tsconfig.json. Enable rules: @typescript-eslint/no-explicit-any as "error",
@typescript-eslint/no-unused-vars as "error" (with argsIgnorePattern "^_"),
"no-console": "warn". Ignore: ["eslint.config.ts", "dist/**", "*.md"]. Enable
@typescript-eslint/recommended rules as the base.

src/index.ts — Binary entry point. Import `program` from `commander`. Set name to "cpe",
description to "Claude Plan Executor — automates planbot → next-phase → summarise-plan",
version to "0.1.0". Add placeholder comments where subcommands will be registered in Phase 05
(src/cli.ts). Call program.parse() at the end. Keep it minimal — no imports from future phases.

src/test/stub.test.ts — One trivial test:
  import { expect, test } from 'bun:test';
  test('bun test is configured', () => {
    expect(1 + 1).toBe(2);
  });

Run `bun install` after creating package.json to install dependencies.

VERIFY each acceptance criterion from PHASE_01.md before committing:
1. bun install succeeds
2. bun run typecheck passes with zero errors
3. bun run lint passes (zero errors; warnings are OK)
4. bun test passes (1 passing test)
5. bun run build produces ./cpe binary
6. ./cpe --help prints help and exits 0
7. ./cpe --version prints 0.1.0

After all criteria pass:
1. git add all new files
2. git commit -m "feat: phase 01 — project skeleton and tooling"
3. git push -u origin feature/claude-plan-executor-phase-1
4. Create PR: gh pr create --base feature/claude-plan-executor --title "Phase 01: Project skeleton + tooling" --fill

Update docs/claude-plan-executor/PROGRESS.md: set phase 01 status to in-progress when you start,
then complete when done. Add today's date as the completed date.

Your final message in this conversation must be a JSON object matching the schema you have been
given. Do all your work using tools first, then emit only the JSON as your closing message.
