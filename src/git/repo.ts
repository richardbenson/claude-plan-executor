export interface ParsedRemote {
  host: string;
  owner: string;
  repo: string;
  type: 'github' | 'gitea' | 'other';
}

function spawn(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(args, { cwd });
  if (proc.exitCode !== 0) {
    throw new Error(`git error (${args.join(' ')}): ${proc.stderr.toString().trim()}`);
  }
  return proc.stdout.toString().trim();
}

export function getPrimaryRepo(): string {
  try {
    return spawn(['git', 'rev-parse', '--show-toplevel'], process.cwd());
  } catch {
    throw new Error('Not inside a git repository');
  }
}

export function getRemote(repoPath: string, giteaHost?: string): ParsedRemote {
  const url = spawn(['git', 'remote', 'get-url', 'origin'], repoPath);

  let host: string;
  let owner: string;
  let repo: string;

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    host = sshMatch[1]!;
    owner = sshMatch[2]!;
    repo = sshMatch[3]!;
  } else {
    // HTTPS: https://github.com/owner/repo.git
    const parsed = new URL(url);
    host = parsed.hostname;
    const parts = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    owner = parts[0] ?? '';
    repo = parts.slice(1).join('/');
  }

  let type: ParsedRemote['type'];
  if (host === 'github.com') {
    type = 'github';
  } else if (giteaHost && host === giteaHost) {
    type = 'gitea';
  } else {
    type = 'other';
  }

  return { host, owner, repo, type };
}

export function getCurrentBranch(repoPath: string): string {
  return spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
}

export function getHead(repoPath: string): string {
  return spawn(['git', 'rev-parse', 'HEAD'], repoPath);
}
