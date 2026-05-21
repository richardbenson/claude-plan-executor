export interface PrResult {
  url: string;
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
