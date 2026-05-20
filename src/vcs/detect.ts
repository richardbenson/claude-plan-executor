export type { ParsedRemote } from '../git/repo.js';
import type { ParsedRemote } from '../git/repo.js';

export function isGitHub(remote: ParsedRemote): boolean {
  return remote.type === 'github';
}

export function isGitea(remote: ParsedRemote): boolean {
  return remote.type === 'gitea';
}
