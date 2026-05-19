You are summarising a completed implementation plan. The plan folder is: PLAN_FOLDER

Your job is to produce a single summary document and then remove the plan folder. Work through these steps:

## Step 1 — Read all plan documents

Read the following files from docs/PLAN_FOLDER/ (use the Read tool for each that exists):
- README.md
- PROGRESS.md
- All PHASE_NN.md files (PHASE_01.md, PHASE_02.md, etc.)
- All PHASE_NN.prompt.md files

## Step 2 — Read the git log

Run: git log --oneline feature/PLAN_FOLDER

This shows what was actually committed to the feature branch. Use this to verify what was built versus what was planned.

## Step 3 — Write docs/PLAN_FOLDER.md

Write a single markdown file at docs/PLAN_FOLDER.md with the following sections:

### Original Requirements
A concise summary of what the user originally asked for. Pull this from README.md.

### What Was Built
A phase-by-phase description of what was implemented, drawn from the phase documents and git log. Note any deviations from the original plan — phases that were skipped, split, or changed in scope.

### Lessons Learned
Key observations from the build process: what worked well, what was harder than expected, any architectural decisions that proved important, gotchas that future work should be aware of.

### Final PR
If a PR URL is visible in PROGRESS.md or any phase document, include it here. Otherwise write "PR not recorded."

## Step 4 — Delete the plan folder

Delete the entire docs/PLAN_FOLDER/ directory using the Bash tool:

```
rm -rf docs/PLAN_FOLDER/
```

## Step 5 — Done

You do not need to emit structured JSON. Once the summary file is written and the folder is deleted, your work is complete. Emit a brief confirmation message.
