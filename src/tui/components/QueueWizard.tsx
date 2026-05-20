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
import type { RepoConfig, BootstrapDetectResult } from '../../config/repo-config.js';

interface PlanInfo { folder: string; phaseCount: number }

type WizardStep =
  | { kind: 'repo'; value: string; error?: string }
  | { kind: 'bootstrap-choice'; repoPath: string; existing: RepoConfig | null; sel: number }
  | { kind: 'bootstrap-detecting'; repoPath: string }
  | { kind: 'bootstrap-review'; repoPath: string; result: BootstrapDetectResult; sel: number }
  | { kind: 'plan-select'; repoPath: string; repoConfig: RepoConfig; plans: PlanInfo[]; sel: number }
  | { kind: 'plan-input'; repoPath: string; repoConfig: RepoConfig; value: string; error?: string }
  | { kind: 'confirm'; repoPath: string; repoConfig: RepoConfig; folder: string; phaseCount: number; runId: string; worktreePath: string }
  | { kind: 'running'; repoPath: string; repoConfig: RepoConfig; folder: string; runId: string; worktreePath: string }
  | { kind: 'done'; runId: string; folder: string; phaseCount: number }
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

  // Queue execution
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
              // Keep existing
              setStep(goToPlanStep(step.repoPath, step.existing));
            } else if (step.sel === 1) {
              // Detect again
              setStep({ kind: 'bootstrap-detecting', repoPath: step.repoPath });
            } else {
              // Skip (empty)
              const cfg: RepoConfig = { bootstrap: [] };
              writeRepoConfig(step.repoPath, cfg);
              setStep(goToPlanStep(step.repoPath, cfg));
            }
          } else {
            if (step.sel === 0) {
              setStep({ kind: 'bootstrap-detecting', repoPath: step.repoPath });
            } else if (step.sel === 1) {
              const cfg: RepoConfig = { bootstrap: [] };
              writeRepoConfig(step.repoPath, cfg);
              setStep(goToPlanStep(step.repoPath, cfg));
            } else {
              const cfg: RepoConfig = { bootstrap: [] };
              writeRepoConfig(step.repoPath, cfg);
              setStep(goToPlanStep(step.repoPath, cfg));
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
            setStep(goToPlanStep(step.repoPath, cfg));
          } else {
            const cfg: RepoConfig = { bootstrap: [] };
            writeRepoConfig(step.repoPath, cfg);
            setStep(goToPlanStep(step.repoPath, cfg));
          }
        }
        if (key.escape) setStep({ kind: 'bootstrap-choice', repoPath: step.repoPath, existing: readRepoConfig(step.repoPath), sel: 0 });
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
        if (key.escape) setStep({ kind: 'bootstrap-choice', repoPath: step.repoPath, existing: step.repoConfig, sel: 0 });
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
        if (key.escape) setStep({ kind: 'bootstrap-choice', repoPath: step.repoPath, existing: step.repoConfig, sel: 0 });
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

    if (step.kind === 'plan-select') return (
      <>
        <Text color={dim}>{'Plans in ' + path.basename(step.repoPath) + '/docs:'}</Text>
        {'error' in step && step.error && <Text color={red}>{String(step.error)}</Text>}
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

    if (step.kind === 'running') return (
      <Box><Spinner /><Text color={dim}>{' ' + (runningMsg || 'Starting…')}</Text></Box>
    );

    if (step.kind === 'done') return (
      <>
        <Text>{''}</Text>
        <Text color={green}>{'✓ Queued: ' + step.folder + ' (' + step.phaseCount + ' phases)'}</Text>
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
    repo: 'repo', 'bootstrap-choice': 'bootstrap', 'bootstrap-detecting': 'detecting',
    'bootstrap-review': 'bootstrap detected', 'plan-select': 'select plan',
    'plan-input': 'plan folder', confirm: 'confirm', running: 'queuing',
    done: 'done', error: 'error',
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
          {'ADD PLAN — ' + stepTitle[step.kind]}
        </Text>
        <Text color={dim}>{'─'.repeat(cardW - 2)}</Text>
        {cardContent()}
      </Box>
    </Box>
  );
}
