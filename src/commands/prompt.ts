import * as fs from 'fs';
import * as path from 'path';
import { ulid } from 'ulid';
import { getPrimaryRepo, getRemote } from '../git/repo.js';
import { createWorktree } from '../git/worktree.js';
import { readConfig } from '../storage/config.js';
import { writeMeta, getLogsDir } from '../storage/meta.js';
import { enqueue } from '../storage/queue.js';
import { ensureRepoConfig, runBootstrap } from '../config/repo-config.js';
import { buildSandboxSettings, injectSandboxSettings } from '../runner/sandbox.js';
import { fetchGitHubIssue } from '../vcs/github.js';
import type { RunMeta } from '../types/meta.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

export async function promptCommand(
  text: string[],
  options?: { disableSandbox?: boolean; githubIssue?: string },
): Promise<void> {
  let prompt: string;
  let promptSource: RunMeta['prompt_source'] = 'free-text';
  let githubIssueNumber: number | undefined;

  if (options?.githubIssue !== undefined) {
    const issueNum = parseInt(options.githubIssue, 10);
    if (isNaN(issueNum) || issueNum <= 0) {
      console.error('--github-issue must be a positive integer.');
      process.exit(1);
    }
    let repoPathForIssue: string;
    try {
      repoPathForIssue = getPrimaryRepo();
    } catch (err) {
      console.error(String(err));
      process.exit(1);
    }
    let issue;
    try {
      issue = fetchGitHubIssue(repoPathForIssue, issueNum);
    } catch (err) {
      console.error(String(err));
      process.exit(1);
    }
    prompt = `#${issue.number}: ${issue.title}\n\n${issue.body}`.trim();
    promptSource = 'github-issue';
    githubIssueNumber = issue.number;
  } else if (text.length > 0) {
    prompt = text.join(' ').trim();
  } else if (!process.stdin.isTTY) {
    prompt = await readStdin();
  } else {
    console.error('Provide a prompt as arguments, pipe via stdin, or use --github-issue <number>.');
    process.exit(1);
  }

  if (!prompt) {
    console.error('Prompt cannot be empty.');
    process.exit(1);
  }

  let repoPath: string;
  try {
    repoPath = getPrimaryRepo();
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  const config = readConfig();
  const repoConfig = await ensureRepoConfig(repoPath, config.gitea_host);

  const runId = ulid();
  const featureBranch = 'feature/sp-' + runId.slice(0, 8).toLowerCase();
  const targetBranch = config.target_branch ?? 'main';

  let worktreePath: string;
  try {
    worktreePath = createWorktree(repoPath, runId, featureBranch, targetBranch);
  } catch (err) {
    console.error(`Failed to create worktree: ${err}`);
    process.exit(1);
  }

  if (repoConfig.bootstrap.length > 0) {
    console.log(`Running ${repoConfig.bootstrap.length} bootstrap command(s)…`);
    const logPath = path.join(getLogsDir(runId), 'bootstrap.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const result = await runBootstrap(worktreePath, repoConfig.bootstrap, logPath);
    if (!result.success) {
      console.error(`Bootstrap failed: ${result.failedCommand} (exit ${result.exitCode})`);
      console.error(`Run logs at: ${logPath}`);
      process.exit(1);
    }
  }

  const sandboxSettings = buildSandboxSettings(config, repoConfig, options?.disableSandbox ?? false);
  const sandboxed = sandboxSettings !== null;
  if (sandboxSettings) {
    injectSandboxSettings(worktreePath, sandboxSettings);
  }

  let remote;
  try {
    remote = getRemote(repoPath, config.gitea_host);
  } catch {
    remote = undefined;
  }

  const meta: RunMeta = {
    id: runId,
    primary_repo_path: repoPath,
    worktree_path: worktreePath,
    feature_branch: featureBranch,
    target_branch: targetBranch,
    remote,
    status: 'queued',
    total_cost_usd: 0,
    bootstrapped: repoConfig.bootstrap.length > 0,
    sandboxed,
    prompt,
    prompt_source: promptSource,
  };
  if (githubIssueNumber !== undefined) meta.github_issue_number = githubIssueNumber;
  writeMeta(runId, meta);

  enqueue(runId, undefined, 'single-prompt');

  console.log(`Queued single-prompt run — run ID ${runId.slice(0, 8)}…`);
  console.log(`Branch:   ${featureBranch}`);
  console.log(`Worktree: ${worktreePath}`);
  console.log(`Prompt:   ${prompt.length > 80 ? prompt.slice(0, 80) + '…' : prompt}`);
  console.log("Run `cpe start` to begin execution.");
}
