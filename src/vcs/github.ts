export interface PrResult {
  url: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
}

export function fetchGitHubIssues(
  repoPath: string,
  state: 'open' | 'closed' = 'open',
  limit: number = 20,
): GitHubIssue[] {
  const proc = Bun.spawnSync(
    ['gh', 'issue', 'list', '--json', 'number,title,body,state', '--state', state, '--limit', String(limit)],
    { cwd: repoPath },
  );

  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString().trim();
    if (stderr.includes('command not found') || proc.exitCode === 127) {
      throw new Error('gh CLI not found. Install it from https://cli.github.com/');
    }
    if (stderr.includes('authentication') || stderr.includes('401') || stderr.includes('not logged in')) {
      throw new Error(`GitHub authentication failed. Run 'gh auth login' to authenticate.\n${stderr}`);
    }
    if (stderr.includes('rate limit') || stderr.includes('429')) {
      throw new Error(`GitHub API rate limit exceeded. Wait before retrying.\n${stderr}`);
    }
    throw new Error(`gh issue list failed: ${stderr}`);
  }

  const stdout = proc.stdout.toString().trim();
  if (!stdout) return [];

  try {
    return JSON.parse(stdout) as GitHubIssue[];
  } catch {
    throw new Error(`Failed to parse gh issue list output: ${stdout}`);
  }
}

export async function createGitHubPr(
  worktreePath: string,
  featureBranch: string,
  targetBranch: string,
): Promise<PrResult> {
  const proc = Bun.spawnSync(
    ['gh', 'pr', 'create', '--base', targetBranch, '--head', featureBranch, '--fill'],
    { cwd: worktreePath },
  );

  if (proc.exitCode !== 0) {
    throw new Error(`gh pr create failed: ${proc.stderr.toString().trim()}`);
  }

  // gh pr create prints the PR URL as the last line of stdout
  const url = proc.stdout.toString().trim().split('\n').pop() ?? '';
  return { url };
}
