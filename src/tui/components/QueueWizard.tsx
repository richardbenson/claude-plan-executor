import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import * as fs from 'fs';
import * as path from 'path';
import { ulid } from 'ulid';
import { Spinner } from './Spinner.js';
import { bgFloat, cyan, bgHi, dim, dim2, fg, green, red, yellow } from '../theme.js';
import { readConfig } from '../../storage/config.js';
import { readRepoConfig, writeRepoConfig, runBootstrap } from '../../config/repo-config.js';
import { writeMeta, getLogsDir } from '../../storage/meta.js';
import { enqueue } from '../../storage/queue.js';
import { createWorktree } from '../../git/worktree.js';
import { getPrimaryRepo, getRemote } from '../../git/repo.js';
import { findPlanFolders, countPhaseFiles, sortedPhaseFiles } from '../../commands/queue.js';
import { BOOTSTRAP_DETECT_PROMPT, BOOTSTRAP_DETECT_SCHEMA } from '../../prompts/index.js';
import { fetchGitHubIssues, type GitHubIssue } from '../../vcs/github.js';
import type { RepoConfig, BootstrapDetectResult } from '../../config/repo-config.js';
import type { RunMeta } from '../../types/meta.js';

interface PlanInfo { folder: string; phaseCount: number }

type WizardStep =
  | { kind: 'repo'; value: string; error?: string }
  | { kind: 'bootstrap-choice'; repoPath: string; existing: RepoConfig | null; sel: number }
  | { kind: 'bootstrap-detecting'; repoPath: string }
  | { kind: 'bootstrap-review'; repoPath: string; result: BootstrapDetectResult; sel: number }
  | { kind: 'entry-type-choice'; repoPath: string; repoConfig: RepoConfig; sel: number }
  | { kind: 'prompt-source-choice'; repoPath: string; repoConfig: RepoConfig; sel: number; error?: string }
  | { kind: 'github-issue-select'; repoPath: string; repoConfig: RepoConfig; issues: GitHubIssue[]; sel: number; loading?: boolean; error?: string }
  | { kind: 'free-text-input'; repoPath: string; repoConfig: RepoConfig; value: string; error?: string }
  | { kind: 'single-prompt-confirm'; repoPath: string; repoConfig: RepoConfig; prompt: string; source: string; githubIssueNumber?: number; runId: string; worktreePath: string; featureBranch: string }
  | { kind: 'running-single'; repoPath: string; repoConfig: RepoConfig; prompt: string; source: string; githubIssueNumber?: number; runId: string; worktreePath: string; featureBranch: string }
  | { kind: 'plan-select'; repoPath: string; repoConfig: RepoConfig; plans: PlanInfo[]; sel: number; error?: string }
  | { kind: 'plan-input'; repoPath: string; repoConfig: RepoConfig; value: string; error?: string }
  | { kind: 'confirm'; repoPath: string; repoConfig: RepoConfig; folder: string; phaseCount: number; runId: string; worktreePath: string }
  | { kind: 'running'; repoPath: string; repoConfig: RepoConfig; folder: string; runId: string; worktreePath: string }
  | { kind: 'done'; runId: string; folder?: string; phaseCount?: number; prompt?: string }
  | { kind: 'error'; message: string };

interface Props {
  onClose: () => void;
  columns: number;
  rows: number;
}

const CARD_W = 80;
const CARD_H = 22;
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

function buildPlanList(repoPath: string): PlanInfo[] {
  return findPlanFolders(repoPath).map(folder => ({
    folder,
    phaseCount: countPhaseFiles(path.join(repoPath, 'docs', folder)),
  })).filter(p => p.phaseCount > 0);
}

function goToPlanStep(repoPath: string, repoConfig: RepoConfig): WizardStep {
  const plans = buildPlanList(repoPath);
  return plans.length > 0
    ? { kind: 'plan-select', repoPath, repoConfig, plans, sel: 0 }
    : { kind: 'plan-input', repoPath, repoConfig, value: '' };
}

function goToEntryTypeChoice(repoPath: string, repoConfig: RepoConfig): WizardStep {
  return { kind: 'entry-type-choice', repoPath, repoConfig, sel: 0 };
}

function makeFeatureBranch(runId: string): string {
  return 'feature/sp-' + runId.slice(0, 8).toLowerCase();
}

export function QueueWizard({ onClose, columns, rows }: Props): React.ReactElement {
  const [step, setStep] = useState<WizardStep>(() => {
    let initialRepo = '';
    try { initialRepo = getPrimaryRepo(); } catch {}
    return { kind: 'repo', value: initialRepo };
  });
  const [detectLines, setDetectLines] = useState<string[]>([]);
  const [runningMsg, setRunningMsg] = useState('');

  // Bootstrap streaming detection via stream-json
  useEffect(() => {
    if (step.kind !== 'bootstrap-detecting') return;
    const { repoPath } = step;
    setDetectLines([]);

    const proc = Bun.spawn(
      ['claude', '-p', '--output-format=stream-json', '--verbose', '--json-schema', BOOTSTRAP_DETECT_SCHEMA],
      {
        cwd: repoPath,
        stdin: new TextEncoder().encode(BOOTSTRAP_DETECT_PROMPT),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    let active = true;

    // Stream stderr (permission prompts, errors) alongside stdout events
    (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let partial = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || !active) break;
          const chunk = partial + decoder.decode(value, { stream: true });
          const parts = chunk.split('\n');
          partial = parts.pop() ?? '';
          const lines = parts.map(l => l.replace(ANSI_RE, '')).filter(l => l.trim());
          if (lines.length > 0) setDetectLines(prev => [...prev, ...lines.map(l => '! ' + l)].slice(-8));
        }
      } catch {}
    })();

    // Stream stdout NDJSON events — parse for display and extract final result
    (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let partial = '';
      let resultObj: BootstrapDetectResult | null = null;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || !active) break;
          const chunk = partial + decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          partial = lines.pop() ?? '';
          for (const raw of lines) {
            const trimmed = raw.trim();
            if (!trimmed) continue;
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const ev: any = JSON.parse(trimmed);
              if (ev.type === 'result') {
                resultObj = (ev.structured_output ?? null) as BootstrapDetectResult | null;
              } else if (ev.type === 'assistant' && ev.message?.content) {
                for (const block of ev.message.content) {
                  let line = '';
                  if (block.type === 'text' && block.text?.trim()) {
                    line = block.text.trim().replace(/\n+/g, ' ').slice(0, 72);
                  } else if (block.type === 'tool_use') {
                    line = 'tool: ' + block.name;
                    const inp = block.input ?? {};
                    if (inp.command) line += '  ' + String(inp.command).slice(0, 48);
                    else if (inp.path)    line += '  ' + String(inp.path).slice(0, 48);
                  }
                  if (line) setDetectLines(prev => [...prev, line].slice(-8));
                }
              } else if (ev.type === 'system' && ev.model) {
                setDetectLines(prev => [...prev, 'model: ' + ev.model].slice(-8));
              }
            } catch {}
          }
        }
      } catch {}

      if (!active) return;

      if (resultObj) {
        setStep({ kind: 'bootstrap-review', repoPath, result: resultObj, sel: 0 });
        return;
      }
      setStep({ kind: 'error', message: 'Detection failed — no structured_output in claude response' });
    })();

    return () => { active = false; try { proc.kill(); } catch {} };
  }, [step.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // GitHub issues fetch
  useEffect(() => {
    if (step.kind !== 'github-issue-select' || !step.loading) return;
    const { repoPath, repoConfig } = step;
    (async () => {
      await Promise.resolve(); // yield to let loading state render
      try {
        const issues = fetchGitHubIssues(repoPath);
        setStep({ kind: 'github-issue-select', repoPath, repoConfig, issues, sel: 0, loading: false });
      } catch (err) {
        setStep(prev =>
          prev.kind === 'github-issue-select'
            ? { ...prev, loading: false, error: String(err) }
            : prev,
        );
      }
    })();
  }, [step.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Queue execution — plan
  useEffect(() => {
    if (step.kind !== 'running') return;
    const { repoPath, repoConfig, folder, runId, worktreePath } = step;
    (async () => {
      try {
        if (repoConfig.bootstrap.length > 0) {
          setRunningMsg('Running ' + repoConfig.bootstrap.length + ' bootstrap command(s)…');
          const logPath = path.join(getLogsDir(runId), 'bootstrap.log');
          fs.mkdirSync(path.dirname(logPath), { recursive: true });
          const result = await runBootstrap(worktreePath, repoConfig.bootstrap, logPath);
          if (!result.success) {
            setStep({ kind: 'error', message: 'Bootstrap failed: ' + result.failedCommand + '\nLog: ' + logPath });
            return;
          }
        }
        setRunningMsg('Building phase list…');
        const planDir = path.join(worktreePath, 'docs', folder);
        const phaseFiles = sortedPhaseFiles(planDir);
        const phases = phaseFiles.map(f => ({
          number: parseInt(f.match(/PHASE_(\d+)/)![1]!, 10),
          prompt_file: f,
          status: 'pending' as const,
          retry_count: 0,
        }));

        setRunningMsg('Writing metadata…');
        const config = readConfig();
        let remote;
        try { remote = getRemote(repoPath, config.gitea_host); } catch { remote = undefined; }
        writeMeta(runId, {
          id: runId,
          primary_repo_path: repoPath,
          worktree_path: worktreePath,
          plan_folder: folder,
          feature_branch: 'feature/' + folder,
          target_branch: config.target_branch ?? 'main',
          remote,
          status: 'queued',
          total_cost_usd: 0,
          bootstrapped: true,
          phases,
        });

        setRunningMsg('Committing plan docs…');
        Bun.spawnSync(['git', 'add', 'docs/' + folder], { cwd: worktreePath });
        Bun.spawnSync(['git', 'commit', '--allow-empty', '-m', 'docs: plan ' + folder], { cwd: worktreePath });

        enqueue(runId);
        setStep({ kind: 'done', runId, folder, phaseCount: phases.length });
      } catch (err) {
        setStep({ kind: 'error', message: String(err) });
      }
    })();
  }, [step.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Queue execution — single-prompt
  useEffect(() => {
    if (step.kind !== 'running-single') return;
    const { repoPath, repoConfig, prompt, source, githubIssueNumber, runId, worktreePath, featureBranch } = step;
    (async () => {
      try {
        if (repoConfig.bootstrap.length > 0) {
          setRunningMsg('Running ' + repoConfig.bootstrap.length + ' bootstrap command(s)…');
          const logPath = path.join(getLogsDir(runId), 'bootstrap.log');
          fs.mkdirSync(path.dirname(logPath), { recursive: true });
          const result = await runBootstrap(worktreePath, repoConfig.bootstrap, logPath);
          if (!result.success) {
            setStep({ kind: 'error', message: 'Bootstrap failed: ' + result.failedCommand + '\nLog: ' + logPath });
            return;
          }
        }

        setRunningMsg('Writing metadata…');
        const config = readConfig();
        let remote;
        try { remote = getRemote(repoPath, config.gitea_host); } catch { remote = undefined; }

        const meta: RunMeta = {
          id: runId,
          primary_repo_path: repoPath,
          worktree_path: worktreePath,
          feature_branch: featureBranch,
          target_branch: config.target_branch ?? 'main',
          remote,
          status: 'queued',
          total_cost_usd: 0,
          bootstrapped: repoConfig.bootstrap.length > 0,
          prompt,
          prompt_source: source as RunMeta['prompt_source'],
        };
        if (githubIssueNumber !== undefined) meta.github_issue_number = githubIssueNumber;
        writeMeta(runId, meta);

        enqueue(runId, undefined, 'single-prompt');
        setStep({ kind: 'done', runId, prompt });
      } catch (err) {
        setStep({ kind: 'error', message: String(err) });
      }
    })();
  }, [step.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useInput((input, key) => {
    switch (step.kind) {

      case 'repo': {
        if (key.return) {
          const repoPath = step.value.trim();
          if (!repoPath) return;
          if (!fs.existsSync(repoPath)) { setStep({ ...step, error: 'Path does not exist' }); return; }
          const existing = readRepoConfig(repoPath);
          setStep({ kind: 'bootstrap-choice', repoPath, existing, sel: 0 });
        }
        if (key.escape) onClose();
        break;
      }

      case 'bootstrap-choice': {
        const optCount = step.existing ? 3 : 3;
        if (key.upArrow)   setStep({ ...step, sel: Math.max(0, step.sel - 1) });
        if (key.downArrow) setStep({ ...step, sel: Math.min(optCount - 1, step.sel + 1) });
        if (key.return) {
          if (step.existing) {
            if (step.sel === 0) {
              setStep(goToEntryTypeChoice(step.repoPath, step.existing));
            } else if (step.sel === 1) {
              setStep({ kind: 'bootstrap-detecting', repoPath: step.repoPath });
            } else {
              const cfg: RepoConfig = { bootstrap: [] };
              writeRepoConfig(step.repoPath, cfg);
              setStep(goToEntryTypeChoice(step.repoPath, cfg));
            }
          } else {
            if (step.sel === 0) {
              setStep({ kind: 'bootstrap-detecting', repoPath: step.repoPath });
            } else if (step.sel === 1) {
              const cfg: RepoConfig = { bootstrap: [] };
              writeRepoConfig(step.repoPath, cfg);
              setStep(goToEntryTypeChoice(step.repoPath, cfg));
            } else {
              const cfg: RepoConfig = { bootstrap: [] };
              writeRepoConfig(step.repoPath, cfg);
              setStep(goToEntryTypeChoice(step.repoPath, cfg));
            }
          }
        }
        if (key.escape) setStep({ kind: 'repo', value: step.repoPath });
        break;
      }

      case 'bootstrap-detecting': {
        if (key.escape) setStep({ kind: 'bootstrap-choice', repoPath: step.repoPath, existing: readRepoConfig(step.repoPath), sel: 0 });
        break;
      }

      case 'bootstrap-review': {
        if (key.leftArrow)  setStep({ ...step, sel: 0 });
        if (key.rightArrow) setStep({ ...step, sel: 1 });
        if (key.return) {
          if (step.sel === 0) {
            const cfg: RepoConfig = { bootstrap: step.result.commands };
            writeRepoConfig(step.repoPath, cfg);
            setStep(goToEntryTypeChoice(step.repoPath, cfg));
          } else {
            const cfg: RepoConfig = { bootstrap: [] };
            writeRepoConfig(step.repoPath, cfg);
            setStep(goToEntryTypeChoice(step.repoPath, cfg));
          }
        }
        if (key.escape) setStep({ kind: 'bootstrap-choice', repoPath: step.repoPath, existing: readRepoConfig(step.repoPath), sel: 0 });
        break;
      }

      case 'entry-type-choice': {
        if (key.upArrow)   setStep({ ...step, sel: Math.max(0, step.sel - 1) });
        if (key.downArrow) setStep({ ...step, sel: Math.min(1, step.sel + 1) });
        if (key.return) {
          if (step.sel === 0) {
            setStep(goToPlanStep(step.repoPath, step.repoConfig));
          } else {
            setStep({ kind: 'prompt-source-choice', repoPath: step.repoPath, repoConfig: step.repoConfig, sel: 0 });
          }
        }
        if (key.escape) setStep({ kind: 'bootstrap-choice', repoPath: step.repoPath, existing: step.repoConfig, sel: 0 });
        break;
      }

      case 'prompt-source-choice': {
        if (key.upArrow)   setStep({ ...step, sel: Math.max(0, step.sel - 1), error: undefined });
        if (key.downArrow) setStep({ ...step, sel: Math.min(2, step.sel + 1), error: undefined });
        if (key.return) {
          if (step.sel === 0) {
            setStep({ kind: 'free-text-input', repoPath: step.repoPath, repoConfig: step.repoConfig, value: '' });
          } else if (step.sel === 1) {
            setStep({ kind: 'github-issue-select', repoPath: step.repoPath, repoConfig: step.repoConfig, issues: [], sel: 0, loading: true });
          } else {
            // Clipboard
            try {
              let clipText = '';
              const xclip = Bun.spawnSync(['xclip', '-o', '-selection', 'clipboard']);
              if (xclip.exitCode === 0) {
                clipText = xclip.stdout.toString().trim();
              } else {
                const pbpaste = Bun.spawnSync(['pbpaste']);
                if (pbpaste.exitCode === 0) clipText = pbpaste.stdout.toString().trim();
              }
              if (!clipText) { setStep({ ...step, error: 'Clipboard is empty or unavailable' }); return; }
              const runId = ulid();
              const featureBranch = makeFeatureBranch(runId);
              const config = readConfig();
              const worktreePath = createWorktree(step.repoPath, runId, featureBranch, config.target_branch ?? 'main');
              setStep({ kind: 'single-prompt-confirm', repoPath: step.repoPath, repoConfig: step.repoConfig, prompt: clipText, source: 'clipboard', runId, worktreePath, featureBranch });
            } catch (err) {
              setStep({ ...step, error: String(err) });
            }
          }
        }
        if (key.escape) setStep({ kind: 'entry-type-choice', repoPath: step.repoPath, repoConfig: step.repoConfig, sel: 1 });
        break;
      }

      case 'github-issue-select': {
        if (step.loading) break;
        if (step.error) {
          // Allow retry with Enter
          if (key.return) setStep({ ...step, error: undefined, loading: true });
          if (key.escape) setStep({ kind: 'prompt-source-choice', repoPath: step.repoPath, repoConfig: step.repoConfig, sel: 1 });
          break;
        }
        if (step.issues.length === 0) {
          if (key.escape) setStep({ kind: 'prompt-source-choice', repoPath: step.repoPath, repoConfig: step.repoConfig, sel: 1 });
          break;
        }
        if (key.upArrow)   setStep({ ...step, sel: Math.max(0, step.sel - 1) });
        if (key.downArrow) setStep({ ...step, sel: Math.min(step.issues.length - 1, step.sel + 1) });
        if (key.return) {
          const issue = step.issues[step.sel];
          if (!issue) return;
          const prompt = `#${issue.number}: ${issue.title}\n\n${issue.body}`.trim();
          try {
            const runId = ulid();
            const featureBranch = makeFeatureBranch(runId);
            const config = readConfig();
            const worktreePath = createWorktree(step.repoPath, runId, featureBranch, config.target_branch ?? 'main');
            setStep({ kind: 'single-prompt-confirm', repoPath: step.repoPath, repoConfig: step.repoConfig, prompt, source: 'github-issue', githubIssueNumber: issue.number, runId, worktreePath, featureBranch });
          } catch (err) {
            setStep({ ...step, error: String(err) });
          }
        }
        if (key.escape) setStep({ kind: 'prompt-source-choice', repoPath: step.repoPath, repoConfig: step.repoConfig, sel: 1 });
        break;
      }

      case 'free-text-input': {
        if (key.return) {
          const prompt = step.value.trim();
          if (!prompt) { setStep({ ...step, error: 'Prompt cannot be empty' }); return; }
          try {
            const runId = ulid();
            const featureBranch = makeFeatureBranch(runId);
            const config = readConfig();
            const worktreePath = createWorktree(step.repoPath, runId, featureBranch, config.target_branch ?? 'main');
            setStep({ kind: 'single-prompt-confirm', repoPath: step.repoPath, repoConfig: step.repoConfig, prompt, source: 'free-text', runId, worktreePath, featureBranch });
          } catch (err) {
            setStep({ ...step, error: String(err) });
          }
        }
        if (key.escape) setStep({ kind: 'prompt-source-choice', repoPath: step.repoPath, repoConfig: step.repoConfig, sel: 0 });
        break;
      }

      case 'single-prompt-confirm': {
        if (key.return) setStep({ kind: 'running-single', repoPath: step.repoPath, repoConfig: step.repoConfig, prompt: step.prompt, source: step.source, githubIssueNumber: step.githubIssueNumber, runId: step.runId, worktreePath: step.worktreePath, featureBranch: step.featureBranch });
        if (key.escape) setStep({ kind: 'prompt-source-choice', repoPath: step.repoPath, repoConfig: step.repoConfig, sel: 0 });
        break;
      }

      case 'plan-select': {
        if (key.upArrow)   setStep({ ...step, sel: Math.max(0, step.sel - 1) });
        if (key.downArrow) setStep({ ...step, sel: Math.min(step.plans.length - 1, step.sel + 1) });
        if (key.return) {
          const plan = step.plans[step.sel];
          if (!plan) return;
          try {
            const runId = ulid();
            const config = readConfig();
            const worktreePath = createWorktree(step.repoPath, runId, 'feature/' + plan.folder, config.target_branch ?? 'main');
            setStep({ kind: 'confirm', repoPath: step.repoPath, repoConfig: step.repoConfig, folder: plan.folder, phaseCount: plan.phaseCount, runId, worktreePath });
          } catch (err) {
            setStep({ ...step, error: String(err) } as WizardStep);
          }
        }
        if (key.escape) setStep({ kind: 'entry-type-choice', repoPath: step.repoPath, repoConfig: step.repoConfig, sel: 0 });
        break;
      }

      case 'plan-input': {
        if (key.return) {
          const folder = step.value.trim();
          if (!folder) return;
          const planDir = path.join(step.repoPath, 'docs', folder);
          if (!fs.existsSync(path.join(planDir, 'PROGRESS.md'))) { setStep({ ...step, error: 'docs/' + folder + '/PROGRESS.md not found' }); return; }
          if (countPhaseFiles(planDir) === 0) { setStep({ ...step, error: 'No PHASE_*.prompt.md files found' }); return; }
          try {
            const runId = ulid();
            const config = readConfig();
            const worktreePath = createWorktree(step.repoPath, runId, 'feature/' + folder, config.target_branch ?? 'main');
            setStep({ kind: 'confirm', repoPath: step.repoPath, repoConfig: step.repoConfig, folder, phaseCount: countPhaseFiles(planDir), runId, worktreePath });
          } catch (err) {
            setStep({ ...step, error: String(err) });
          }
        }
        if (key.escape) setStep({ kind: 'entry-type-choice', repoPath: step.repoPath, repoConfig: step.repoConfig, sel: 0 });
        break;
      }

      case 'confirm': {
        if (key.return) setStep({ kind: 'running', repoPath: step.repoPath, repoConfig: step.repoConfig, folder: step.folder, runId: step.runId, worktreePath: step.worktreePath });
        if (key.escape) setStep(goToPlanStep(step.repoPath, step.repoConfig));
        break;
      }

      case 'done':
      case 'error': {
        onClose();
        break;
      }
    }
  });

  // ── Positioning ──────────────────────────────────────────────────────────
  const manageH = rows - 2; // Manage box height (App subtracts 1 for header, Manage subtracts 1 more)
  const cardW = Math.min(columns - 4, CARD_W);
  const top  = Math.max(0, Math.floor((manageH - CARD_H) / 2));
  const left = Math.max(0, Math.floor((columns - cardW) / 2));

  // ── Render ────────────────────────────────────────────────────────────────
  function cardContent(): React.ReactElement {
    if (step.kind === 'repo') return (
      <>
        <Text color={dim2}>Repo path (absolute path to a git repository):</Text>
        <Box><Text color={cyan}>{`> `}</Text><TextInput value={step.value} onChange={v => setStep({ ...step, value: v, error: undefined })} /></Box>
        {step.error && <Text color={red}>{step.error}</Text>}
        <Text color={dim}>{'\n↵ confirm  Esc cancel'}</Text>
      </>
    );

    if (step.kind === 'bootstrap-choice') {
      const { existing } = step;
      const opts = existing
        ? [
            { label: 'Keep current', desc: existing.bootstrap.length ? existing.bootstrap.join(', ') : 'no bootstrap commands' },
            { label: 'Detect with Claude (~$0.05)', desc: 'Re-run detection against this repo' },
            { label: 'Skip', desc: 'Use empty bootstrap' },
          ]
        : [
            { label: 'Detect with Claude (~$0.05)', desc: 'One-off LLM call to suggest bootstrap commands' },
            { label: 'Create empty config', desc: 'Write cpe.config.json with no bootstrap step' },
            { label: 'Skip', desc: 'No bootstrap needed' },
          ];
      return (
        <>
          <Text color={existing ? dim2 : fg}>{existing ? `cpe.config.json found in ${path.basename(step.repoPath)}` : `No cpe.config.json found in ${path.basename(step.repoPath)}`}</Text>
          <Text>{''}</Text>
          {opts.map((o, i) => (
            <Box key={i} backgroundColor={step.sel === i ? bgHi : undefined}>
              <Text color={step.sel === i ? cyan : dim}>{step.sel === i ? '▶ ' : '  '}</Text>
              <Text color={fg}>{(o.label + '  ').padEnd(32)}</Text>
              <Text color={dim2}>{o.desc}</Text>
            </Box>
          ))}
          <Text color={dim}>{'\n↑↓ select  ↵ confirm  Esc back'}</Text>
        </>
      );
    }

    if (step.kind === 'bootstrap-detecting') return (
      <>
        <Box><Spinner /><Text color={dim}>{' Detecting bootstrap commands with Claude…'}</Text></Box>
        {detectLines.map((line, i) => <Text key={i} color={dim2} wrap="truncate">{'  ' + line}</Text>)}
      </>
    );

    if (step.kind === 'bootstrap-review') {
      const { result, sel } = step;
      return (
        <>
          <Text color={dim}>Suggested commands:</Text>
          {result.commands.map((cmd, i) => <Text key={i} color={fg}>{'  ' + cmd}</Text>)}
          <Text>{''}</Text>
          {result.reasoning && <Text color={dim2} wrap="truncate">{'Reasoning: ' + result.reasoning}</Text>}
          {result.blockers?.map((b, i) => <Text key={i} color={yellow}>{'  ⚠ ' + b}</Text>)}
          <Text>{''}</Text>
          <Box>
            {['Accept', 'Skip'].map((label, i) => (
              <Box key={i} backgroundColor={sel === i ? bgHi : undefined} marginRight={2} paddingX={1}>
                <Text color={sel === i ? cyan : dim2}>{label}</Text>
              </Box>
            ))}
          </Box>
          <Text color={dim}>{'\n←→ select  ↵ confirm  Esc back'}</Text>
        </>
      );
    }

    if (step.kind === 'entry-type-choice') {
      const opts = [
        { label: 'Plan', desc: 'Execute a multi-phase plan from docs/' },
        { label: 'Single Prompt', desc: 'Run a single AI prompt on this repo' },
      ];
      return (
        <>
          <Text color={dim}>{'What would you like to queue?'}</Text>
          <Text>{''}</Text>
          {opts.map((o, i) => (
            <Box key={i} backgroundColor={step.sel === i ? bgHi : undefined}>
              <Text color={step.sel === i ? cyan : dim}>{step.sel === i ? '▶ ' : '  '}</Text>
              <Text color={fg}>{(o.label + '  ').padEnd(20)}</Text>
              <Text color={dim2}>{o.desc}</Text>
            </Box>
          ))}
          <Text color={dim}>{'\n↑↓ select  ↵ confirm  Esc back'}</Text>
        </>
      );
    }

    if (step.kind === 'prompt-source-choice') {
      const opts = [
        { label: 'Free text', desc: 'Type a prompt directly' },
        { label: 'GitHub issue', desc: 'Pick an open issue from this repo' },
        { label: 'Clipboard', desc: 'Use text currently in clipboard' },
      ];
      return (
        <>
          <Text color={dim}>{'Choose prompt source:'}</Text>
          <Text>{''}</Text>
          {opts.map((o, i) => (
            <Box key={i} backgroundColor={step.sel === i ? bgHi : undefined}>
              <Text color={step.sel === i ? cyan : dim}>{step.sel === i ? '▶ ' : '  '}</Text>
              <Text color={fg}>{(o.label + '  ').padEnd(20)}</Text>
              <Text color={dim2}>{o.desc}</Text>
            </Box>
          ))}
          {step.error && <><Text>{''}</Text><Text color={red}>{step.error}</Text></>}
          <Text color={dim}>{'\n↑↓ select  ↵ confirm  Esc back'}</Text>
        </>
      );
    }

    if (step.kind === 'github-issue-select') {
      if (step.loading) return (
        <>
          <Box><Spinner /><Text color={dim}>{' Fetching GitHub issues…'}</Text></Box>
        </>
      );
      if (step.error) return (
        <>
          <Text>{''}</Text>
          <Text color={red} wrap="wrap">{step.error}</Text>
          <Text color={dim}>{'\n↵ retry  Esc back'}</Text>
        </>
      );
      if (step.issues.length === 0) return (
        <>
          <Text>{''}</Text>
          <Text color={dim2}>No open issues found.</Text>
          <Text color={dim}>{'\nEsc back'}</Text>
        </>
      );
      return (
        <>
          <Text color={dim}>{'Select a GitHub issue:'}</Text>
          {step.issues.slice(0, 12).map((issue, i) => (
            <Box key={issue.number} backgroundColor={step.sel === i ? bgHi : undefined}>
              <Text color={step.sel === i ? cyan : dim}>{step.sel === i ? '▶ ' : '  '}</Text>
              <Text color={dim2}>{('#' + String(issue.number)).padEnd(6)}</Text>
              <Text color={fg} wrap="truncate">{issue.title}</Text>
            </Box>
          ))}
          <Text color={dim}>{'\n↑↓ select  ↵ confirm  Esc back'}</Text>
        </>
      );
    }

    if (step.kind === 'free-text-input') return (
      <>
        <Text color={dim}>Enter your prompt:</Text>
        <Box><Text color={cyan}>{`> `}</Text><TextInput value={step.value} onChange={v => setStep({ ...step, value: v, error: undefined })} /></Box>
        {step.error && <Text color={red}>{step.error}</Text>}
        <Text color={dim}>{'\n↵ confirm  Esc back'}</Text>
      </>
    );

    if (step.kind === 'single-prompt-confirm') {
      const preview = step.prompt.length > 120 ? step.prompt.slice(0, 120) + '…' : step.prompt;
      return (
        <>
          <Text>{''}</Text>
          <Text><Text color={dim}>{'source    '}</Text><Text color={fg}>{step.source}</Text></Text>
          {step.githubIssueNumber !== undefined && (
            <Text><Text color={dim}>{'issue     '}</Text><Text color={fg}>{'#' + step.githubIssueNumber}</Text></Text>
          )}
          <Text><Text color={dim}>{'branch    '}</Text><Text color={fg}>{step.featureBranch}</Text></Text>
          <Text><Text color={dim}>{'bootstrap '}</Text><Text color={dim2}>{step.repoConfig.bootstrap.length === 0 ? 'none' : step.repoConfig.bootstrap.join(', ')}</Text></Text>
          <Text><Text color={dim}>{'run id    '}</Text><Text color={dim2}>{step.runId.slice(0, 8) + '…'}</Text></Text>
          <Text>{''}</Text>
          <Text color={dim}>{'prompt:'}</Text>
          <Text color={dim2} wrap="wrap">{preview}</Text>
          <Text color={dim}>{'\n↵ queue  Esc back'}</Text>
        </>
      );
    }

    if (step.kind === 'running' || step.kind === 'running-single') return (
      <Box><Spinner /><Text color={dim}>{' ' + (runningMsg || 'Starting…')}</Text></Box>
    );

    if (step.kind === 'plan-select') return (
      <>
        <Text color={dim}>{'Plans in ' + path.basename(step.repoPath) + '/docs:'}</Text>
        {step.error && <Text color={red}>{step.error}</Text>}
        {step.plans.map((p, i) => (
          <Box key={p.folder} backgroundColor={step.sel === i ? bgHi : undefined}>
            <Text color={step.sel === i ? cyan : dim}>{step.sel === i ? '▶ ' : '  '}</Text>
            <Text color={fg}>{p.folder.padEnd(36)}</Text>
            <Text color={dim2}>{p.phaseCount + ' phases'}</Text>
          </Box>
        ))}
        <Text color={dim}>{'\n↑↓ select  ↵ confirm  Esc back'}</Text>
      </>
    );

    if (step.kind === 'plan-input') return (
      <>
        <Text color={dim}>No plans found. Enter folder name (relative to docs/):</Text>
        <Box><Text color={cyan}>docs/ </Text><TextInput value={step.value} onChange={v => setStep({ ...step, value: v, error: undefined })} /></Box>
        {step.error && <Text color={red}>{step.error}</Text>}
        <Text color={dim}>{'\n↵ confirm  Esc back'}</Text>
      </>
    );

    if (step.kind === 'confirm') return (
      <>
        <Text>{''}</Text>
        <Text><Text color={dim}>{'repo      '}</Text><Text color={fg}>{step.repoPath}</Text></Text>
        <Text><Text color={dim}>{'plan      '}</Text><Text color={fg}>{step.folder}</Text></Text>
        <Text><Text color={dim}>{'phases    '}</Text><Text color={fg}>{String(step.phaseCount)}</Text></Text>
        <Text><Text color={dim}>{'branch    '}</Text><Text color={fg}>{'feature/' + step.folder}</Text></Text>
        <Text><Text color={dim}>{'bootstrap '}</Text><Text color={dim2}>{step.repoConfig.bootstrap.length === 0 ? 'none' : step.repoConfig.bootstrap.join(', ')}</Text></Text>
        <Text><Text color={dim}>{'run id    '}</Text><Text color={dim2}>{step.runId.slice(0, 8) + '…'}</Text></Text>
        <Text color={dim}>{'\n↵ queue  Esc back'}</Text>
      </>
    );

    if (step.kind === 'done') return (
      <>
        <Text>{''}</Text>
        {step.folder
          ? <Text color={green}>{'✓ Queued: ' + step.folder + ' (' + String(step.phaseCount) + ' phases)'}</Text>
          : <Text color={green}>{'✓ Queued single-prompt run'}</Text>
        }
        {step.prompt && <Text color={dim2} wrap="truncate">{'  prompt  ' + step.prompt.slice(0, 48)}</Text>}
        <Text color={dim2}>{'  run id  ' + step.runId.slice(0, 8) + '…'}</Text>
        <Text color={dim}>{'\nany key to close'}</Text>
      </>
    );

    // error
    return (
      <>
        <Text>{''}</Text>
        <Text color={red}>{step.message}</Text>
        <Text color={dim}>{'\nany key to close'}</Text>
      </>
    );
  }

  const stepTitle: Record<WizardStep['kind'], string> = {
    repo: 'repo',
    'bootstrap-choice': 'bootstrap',
    'bootstrap-detecting': 'detecting',
    'bootstrap-review': 'bootstrap detected',
    'entry-type-choice': 'entry type',
    'prompt-source-choice': 'prompt source',
    'github-issue-select': 'select issue',
    'free-text-input': 'enter prompt',
    'single-prompt-confirm': 'confirm',
    'running-single': 'queuing',
    'plan-select': 'select plan',
    'plan-input': 'plan folder',
    confirm: 'confirm',
    running: 'queuing',
    done: 'done',
    error: 'error',
  };

  return (
    <Box position="absolute" top={top} left={left}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={step.kind === 'error' ? red : step.kind === 'done' ? green : cyan}
        backgroundColor={bgFloat}
        width={cardW}
        height={CARD_H}
      >
        <Text color={step.kind === 'error' ? red : cyan}>
          {'ADD TO QUEUE — ' + stepTitle[step.kind]}
        </Text>
        <Text color={dim}>{'─'.repeat(cardW - 2)}</Text>
        {cardContent()}
      </Box>
    </Box>
  );
}
