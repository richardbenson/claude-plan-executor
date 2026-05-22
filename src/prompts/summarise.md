You are finalising a completed implementation plan.

Plan folder:   PLAN_FOLDER
Feature branch: FEATURE_BRANCH
Target branch:  TARGET_BRANCH
Skip push/PR:   SKIP_PUSH_AND_PR

## Step 1 — Read all plan documents

Read the following files from docs/PLAN_FOLDER/ (use the Read tool for each that exists):
- README.md
- PROGRESS.md
- All PHASE_NN.md files (PHASE_01.md, PHASE_02.md, etc.)
- All PHASE_NN.prompt.md files

## Step 2 — Read the git log

Run: `git log --oneline FEATURE_BRANCH`

This shows what was actually committed. Use it to verify what was built versus what was planned.

## Step 3 — Write docs/PLAN_FOLDER.md

Write a single markdown file at docs/PLAN_FOLDER.md with these sections:

### Original Requirements
What the user originally asked for, drawn from README.md.

### What Was Built
Phase-by-phase description of what was implemented, from the phase documents and git log. Note any deviations — phases skipped, split, or changed in scope.

### Lessons Learned
Key observations: what worked well, what was harder than expected, important architectural decisions, gotchas future work should know about.

## Step 4 — Delete the plan folder

```bash
rm -rf docs/PLAN_FOLDER/
```

## Step 5 — Commit

```bash
git add -A
git commit -m "docs: summarise PLAN_FOLDER"
```

## Step 6 — Push and open pull request

**If SKIP_PUSH_AND_PR is `true`, skip this step entirely and go to Step 7.**

Push the branch:

```bash
git push -u origin FEATURE_BRANCH
```

Now compose the PR. Use everything you read in Steps 1–2 as source material.

**Title**: a concise sentence under 72 characters describing the change in plain English. Do not use the branch name. Focus on what the feature does, not how it was implemented. Good example: "Add dark mode toggle with per-user preference persistence". Bad example: "feature/dark-mode".

**Body** must include all four sections below. Be specific — a reviewer who has not seen the plan docs should be able to understand what changed and how to test it.

```markdown
## Summary

- <bullet 1>
- <bullet 2>
- <bullet 3 — 2–4 bullets total>

## Changes by phase

- Phase 1: <what it delivered>
- Phase 2: <what it delivered>
- ...

## Testing steps

1. <concrete step — e.g. "Run `npm test` and confirm all tests pass">
2. <step — e.g. "Start the dev server with `npm run dev`">
3. <step — e.g. "Navigate to /settings and toggle dark mode">
4. <expected outcome — e.g. "The page re-renders with a dark background and the preference persists on reload">
Include enough steps that a developer unfamiliar with the codebase can verify the feature end-to-end.

## Notes

<Known limitations, deferred work, or anything the reviewer should watch for. Write "None." if there is nothing to flag.>
```

Write the body to a temp file to avoid shell quoting issues, then create the PR:

```bash
cat > /tmp/cpe-pr-body.md << 'PREOF'
<your composed body here>
PREOF
```

Try `gh` first:
```bash
gh pr create --base TARGET_BRANCH --head FEATURE_BRANCH --title "<your title>" --body-file /tmp/cpe-pr-body.md
```

If `gh` is not available or fails, try `tea`:
```bash
tea pr create --base TARGET_BRANCH --head FEATURE_BRANCH --title "<your title>" --description "$(cat /tmp/cpe-pr-body.md)"
```

## Step 7 — Done

Emit a brief confirmation. If a PR was created, include the URL.
