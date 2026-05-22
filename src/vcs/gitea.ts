import type { ParsedRemote } from '../git/repo.js';
import type { PrOptions } from './github.js';

export interface PrResult {
  url: string;
}

export async function createGiteaPr(
  worktreePath: string,
  featureBranch: string,
  targetBranch: string,
  remote: ParsedRemote,
  opts?: PrOptions,
): Promise<PrResult> {
  // Try tea CLI first
  const teaArgs = ['tea', 'pr', 'create', '--base', targetBranch, '--head', featureBranch];
  if (opts?.title) teaArgs.push('--title', opts.title);
  if (opts?.body) teaArgs.push('--description', opts.body);
  const teaProc = Bun.spawnSync(teaArgs, { cwd: worktreePath });

  if (teaProc.exitCode === 0) {
    const stdout = teaProc.stdout.toString();
    const lines = stdout.split('\n');
    const urlLine = lines.find(l => l.includes('https://'));
    if (urlLine) {
      const match = urlLine.match(/https:\/\/\S+/);
      if (match) {
        return { url: match[0] };
      }
    }
    throw new Error(`tea pr create succeeded but no URL found in output: ${stdout}`);
  }

  // Check if tea was not found (ENOENT-like exit) vs. other error
  const teaErr = teaProc.stderr.toString();
  const teaNotFound =
    teaProc.exitCode !== 0 &&
    (teaErr.includes('not found') || teaErr.includes('No such file') || teaErr.includes('command not found'));

  if (!teaNotFound) {
    throw new Error(`tea pr create failed: ${teaErr.trim()}`);
  }

  // Fall back to Gitea REST API
  let token = process.env['GITEA_TOKEN'];
  if (!token) {
    const configProc = Bun.spawnSync(['git', 'config', '--get', 'gitea.token'], { cwd: worktreePath });
    if (configProc.exitCode === 0) {
      token = configProc.stdout.toString().trim();
    }
  }

  if (!token) {
    throw new Error('No Gitea auth: set GITEA_TOKEN or configure tea CLI');
  }

  const url = `https://${remote.host}/api/v1/repos/${remote.owner}/${remote.repo}/pulls`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      head: featureBranch,
      base: targetBranch,
      title: opts?.title ?? featureBranch,
      ...(opts?.body ? { body: opts.body } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Gitea REST API error ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { html_url: string };
  return { url: data.html_url };
}
