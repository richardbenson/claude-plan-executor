---

## How this run is evaluated (IMPORTANT — read carefully)

You are running **headless** inside cpe: there is no interactive session and no
structured-output channel. cpe reads the result of your work from a file you
write. Complete these steps **in order**.

### Implement
Do the task described above, following the repository's existing conventions. Run
any relevant build / test / type-check steps and fix problems before continuing.

### Commit
Stage and commit ALL your changes as a SINGLE conventional commit
(`<type>: <short description>`; types: feat, fix, refactor, docs, test, chore).
Do not make intermediate commits.
{{PR_STEP}}
### Report (REQUIRED — do this LAST)
As your **final action**, write the file `.cpe/result.json` (relative to the
repository root) containing EXACTLY this JSON object and nothing else:

```json
{
  "completed": true,
  "committed": true,
  "commit_message": "feat: ...",
  "summary": "One or two sentences describing what changed.",
  "blockers": [],
  "notes_for_next_phase": ""{{PR_FIELDS}}
}
```

Field meanings:
- `completed`: `true` only if the task's goal was fully achieved; `false` if any
  part was skipped, deferred, or blocked.
- `committed` / `commit_message`: reflect the commit you made (or `false` / `null`).
- `summary`: one or two sentences describing what changed.
- `blockers`: anything that prevented full completion (empty array if none).
- `notes_for_next_phase`: information a follow-up phase should know, or `""`.

Do **not** commit `.cpe/result.json` — leave it uncommitted; cpe reads and removes
it. Even if you could not finish, still write the file with `"completed": false`
and explain why in `blockers`.
