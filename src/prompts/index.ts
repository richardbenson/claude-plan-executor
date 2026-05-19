import { resolve } from "node:path";

const dir = import.meta.dir;

export const PLANBOT_PROMPT: string = await Bun.file(
  resolve(dir, "planbot.md")
).text();

export const SUMMARISE_PROMPT: string = await Bun.file(
  resolve(dir, "summarise.md")
).text();

export const BOOTSTRAP_DETECT_PROMPT: string = await Bun.file(
  resolve(dir, "bootstrap-detect.md")
).text();

export const PHASE_RESULT_SCHEMA: string = await Bun.file(
  resolve(dir, "phase-result-schema.json")
).text();

export const PHASE_RESULT_SCHEMA_PATH: string = resolve(
  dir,
  "phase-result-schema.json"
);

export const BOOTSTRAP_DETECT_SCHEMA_PATH: string = resolve(
  dir,
  "bootstrap-detect-schema.json"
);
