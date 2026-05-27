import { CPE_VERSION } from '../version.js';

export async function versionCommand(): Promise<void> {
  process.stdout.write(`cpe ${CPE_VERSION}\n`);
}
