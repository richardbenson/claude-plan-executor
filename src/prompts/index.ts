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
import _phaseResultSchemaObj from './phase-result-schema.json';
import _bootstrapDetectSchemaObj from './bootstrap-detect-schema.json';
import _singlePromptResultSchemaObj from './single-prompt-result-schema.json';

export const PLANBOT_PROMPT: string = _planbot as unknown as string;
export const SUMMARISE_PROMPT: string = _summarise as unknown as string;
export const BOOTSTRAP_DETECT_PROMPT: string = _bootstrapDetect as unknown as string;
export const SINGLE_PROMPT_TEMPLATE: string = _singlePrompt as unknown as string;
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
