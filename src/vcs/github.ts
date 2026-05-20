export interface PrResult {
  url: string;
}

export async function createGitHubPr(
  worktreePath: string,
  featureBranch: string,
  targetBranch: string,
): Promise<PrResult> {
  const proc = Bun.spawnSync(
    ['gh', 'pr', 'create', '--base', targetBranch, '--head', featureBranch, '--fill', '--json', 'url'],
    { cwd: worktreePath },
  );

  if (proc.exitCode !== 0) {
    throw new Error(`gh pr create failed: ${proc.stderr.toString().trim()}`);
  }

  const data = JSON.parse(proc.stdout.toString()) as { url: string };
  return { url: data.url };
}
