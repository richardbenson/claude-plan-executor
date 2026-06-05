import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// @ts-expect-error — Bun text import (embedded into compiled binary)
import _planbot from './planbot.md' with { type: 'text' };
// @ts-expect-error — Bun text import
import _summarise from './summarise.md' with { type: 'text' };
// @ts-expect-error — Bun text import
import _bootstrapDetect from './bootstrap-detect.md' with { type: 'text' };
// @ts-expect-error — Bun text import
import _singlePrompt from './single-prompt.md' with { type: 'text' };
// @ts-expect-error — Bun text import
import _opaqueContract from './opaque-contract.md' with { type: 'text' };
// @ts-expect-error — Bun text import
import _summarizeResult from './summarize-result.md' with { type: 'text' };
import _phaseResultSchemaObj from './phase-result-schema.json';
import _bootstrapDetectSchemaObj from './bootstrap-detect-schema.json';
import _singlePromptResultSchemaObj from './single-prompt-result-schema.json';

export const PLANBOT_PROMPT: string = _planbot as unknown as string;
export const SUMMARISE_PROMPT: string = _summarise as unknown as string;
export const BOOTSTRAP_DETECT_PROMPT: string = _bootstrapDetect as unknown as string;
export const SINGLE_PROMPT_TEMPLATE: string = _singlePrompt as unknown as string;
export const OPAQUE_CONTRACT: string = _opaqueContract as unknown as string;

/** The push/PR step injected into the opaque contract for single-prompt runs only. */
const OPAQUE_PR_STEP = `
### Push & open a pull request
Push the branch and open a pull request using whatever tool is available
(\`gh pr create\`, \`tea pr create\`, etc.). The title should be a plain-English
sentence describing the change; the body should summarise what changed and how to
verify it.
`;

/**
 * Append the opaque "reporting contract" to a base prompt (a phase prompt or a
 * raw single-prompt task). Opaque harnesses have no structured-output channel, so
 * the contract tells the agent to commit, optionally open a PR, and write its
 * result to `.cpe/result.json` for cpe to read. `withPr` adds the PR step + the
 * `pr_created`/`pr_url` result fields (single-prompt); phases omit them.
 */
export function buildOpaquePrompt(base: string, opts: { withPr: boolean }): string {
  const prStep = opts.withPr ? OPAQUE_PR_STEP : '';
  const prFields = opts.withPr
    ? ',\n  "pr_created": true,\n  "pr_url": "https://... or null"'
    : '';
  const contract = OPAQUE_CONTRACT
    .replace('{{PR_STEP}}', prStep)
    .replace('{{PR_FIELDS}}', prFields);
  return `${base.trimEnd()}\n\n${contract}`;
}

export const SUMMARIZE_RESULT_PROMPT: string = _summarizeResult as unknown as string;

/** Build the summarization prompt from a git diff + transcript tail (both truncated). */
export function buildSummarizePrompt(diff: string, transcript: string): string {
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '\n…(truncated)…' : s);
  return SUMMARIZE_RESULT_PROMPT
    .replace('{{DIFF}}', clip(diff.trim() || '(empty diff)', 12000))
    .replace('{{TRANSCRIPT}}', clip(transcript.trim() || '(no transcript)', 6000));
}
export const PHASE_RESULT_SCHEMA: string = JSON.stringify(_phaseResultSchemaObj);
export const BOOTSTRAP_DETECT_SCHEMA: string = JSON.stringify(_bootstrapDetectSchemaObj);
export const SINGLE_PROMPT_RESULT_SCHEMA: string = JSON.stringify(_singlePromptResultSchemaObj);

function writeTempSchema(name: string, content: string): string {
  const dir = path.join(os.tmpdir(), 'cpe-schemas');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, content);
  }
  return p;
}

export function getPhaseResultSchemaPath(): string {
  return writeTempSchema('phase-result-schema.json', PHASE_RESULT_SCHEMA);
}

export function getBootstrapDetectSchemaPath(): string {
  return writeTempSchema(
    'bootstrap-detect-schema.json',
    JSON.stringify(_bootstrapDetectSchemaObj, null, 2),
  );
}

export function getSinglePromptResultSchemaPath(): string {
  return writeTempSchema('single-prompt-result-schema.json', SINGLE_PROMPT_RESULT_SCHEMA);
}

export const PHASE_RESULT_SCHEMA_PATH: string = getPhaseResultSchemaPath();
export const BOOTSTRAP_DETECT_SCHEMA_PATH: string = getBootstrapDetectSchemaPath();
export const SINGLE_PROMPT_RESULT_SCHEMA_PATH: string = getSinglePromptResultSchemaPath();
