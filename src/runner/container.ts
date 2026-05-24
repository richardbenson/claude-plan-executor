import * as fs from 'fs';

export function isRunningInContainer(): boolean {
  if (fs.existsSync('/.dockerenv')) return true;
  if (fs.existsSync('/run/.containerenv')) return true;
  if (process.env['container']) return true;
  return false;
}
