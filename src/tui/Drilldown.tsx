import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StateChip } from './components/StateChip.js';
import { border, cyan, bgHi, dim, dim2, fg, green2 } from './theme.js';
import { STATE_TABLE } from '../types/state.js';
import { useInteractiveSubprocess } from './SubprocessContext.js';
import { activityBus } from '../events/bus.js';
import { readMeta, getLogsDir, updatePhase, updateMeta } from '../storage/meta.js';
import type { RunMeta, PhaseEntry } from '../types/meta.js';

interface Props {
  runId: string;
  phaseNumber: number;
  onClose: () => void;
  columns: number;
  rows: number;
}

function formatDuration(startedAt: string | undefined, completedAt: string | undefined): string {
  if (!startedAt) return '—';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const s = Math.floor((end - start) / 1000);
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

function formatTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function phaseLabel(promptFile: string): string {
  const m = promptFile.match(/PHASE_(\d+)/i);
  return m ? m[1] ?? promptFile : promptFile;
}

function readLogTail(runId: string, phaseNumber: number): string[] {
  const logsDir = getLogsDir(runId);
  const logFile = path.join(logsDir, 'phase-' + String(phaseNumber).padStart(2, '0') + '.log');
  try {
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l.length > 0);
    return lines.slice(-3);
  } catch {
    return [];
  }
}

export function Drilldown({ runId, phaseNumber, onClose, columns, rows }: Props): React.ReactElement {
  let meta: RunMeta;
  try {
    meta = readMeta(runId);
  } catch {
    return (
      <Box>
        <Text color={dim}>{'Could not load run meta'}</Text>
      </Box>
    );
  }

  const [selectedPhaseNumber, setSelectedPhaseNumber] = useState(phaseNumber);
  const runInteractive = useInteractiveSubprocess();
  const phases = meta.phases ?? [];
  const selectedIdx = phases.findIndex(p => p.number === selectedPhaseNumber);
  const phase: PhaseEntry | undefined = phases[selectedIdx < 0 ? 0 : selectedIdx];

  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.upArrow || input === 'k') {
      setSelectedPhaseNumber(phases[Math.max(0, (selectedIdx < 0 ? 0 : selectedIdx) - 1)]?.number ?? selectedPhaseNumber);
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelectedPhaseNumber(phases[Math.min(phases.length - 1, (selectedIdx < 0 ? 0 : selectedIdx) + 1)]?.number ?? selectedPhaseNumber);
      return;
    }
    if (input === 'l' && phase) {
      const logsDir = getLogsDir(runId);
      const logFile = path.join(logsDir, 'phase-' + String(phase.number).padStart(2, '0') + '.log');
      runInteractive([process.env['PAGER'] ?? 'less', logFile]);
      return;
    }
    if (input === 'e' && phase) {
      runInteractive([process.env['EDITOR'] ?? 'vi', meta.worktree_path]);
      return;
    }
    if (input === 'd' && phase?.head_before && phase.commit_sha) {
      const pager = process.env['PAGER'] ?? 'less';
      runInteractive(['sh', '-c', 'git diff ' + phase.head_before + '..' + phase.commit_sha + ' | ' + pager]);
      return;
    }
    if (input === 'r' && phase) {
      const pid = meta.claude_pid;
      if (pid) {
        try { process.kill(pid, 'SIGTERM'); } catch {}
      }
      updatePhase(runId, phase.number, { status: 'pending', retry_count: 0 });
      updateMeta(runId, { status: 'queued' });
      try { meta = readMeta(runId); } catch {}
      return;
    }
    if (input === 's' && phase) {
      updatePhase(runId, phase.number, { status: 'failed', summary: 'skipped by user' });
      const nextPhase = (meta.phases ?? []).find(p => p.number > phase.number);
      if (nextPhase) {
        updatePhase(runId, nextPhase.number, { status: 'pending' });
      }
      updateMeta(runId, { status: 'queued' });
      try { meta = readMeta(runId); } catch {}
      return;
    }
  });

  const leftWidth = 48;
  const rightWidth = columns - leftWidth - 2;

  const phaseEvents = phase
    ? activityBus.getBuffer().filter(
        e => e.runId === runId && e.phaseNumber === phase.number,
      ).slice(-15)
    : [];

  const logTail = phase ? readLogTail(runId, phase.number) : [];

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box flexDirection="row" flexGrow={1}>
        {/* Left pane: phase list */}
        <Box flexDirection="column" width={leftWidth} borderStyle="round" borderColor={border}>
          <Text color={dim}>{'PHASES · ' + (meta.plan_folder ?? '')}</Text>
          {phases.map((p) => {
            const sel = p.number === selectedPhaseNumber;
            const label = p.title ?? phaseLabel(p.prompt_file);
            return (
              <Box key={p.number} backgroundColor={sel ? bgHi : undefined}>
                <StateChip status={p.status} showLabel={false} />
                <Text>{' ' + String(p.number).padStart(2, '0') + ' ' + label}</Text>
                {p.cost_usd != null && <Text color={dim2}>{'  $' + p.cost_usd.toFixed(3)}</Text>}
              </Box>
            );
          })}
        </Box>

        <Text color={dim}>{' '}</Text>

        {/* Right pane: phase details */}
        <Box flexDirection="column" width={rightWidth} borderStyle="round" borderColor={cyan}>
          {phase ? (
            <>
              {/* 1. Metadata */}
              <Box flexDirection="row" flexWrap="wrap">
                <StateChip status={phase.status} />
                <Text color={dim}>{' · sandbox '}</Text>
                <Text color={meta.sandboxed ? STATE_TABLE.complete.color : dim}>{meta.sandboxed ? 'enabled' : 'disabled'}</Text>
                {phase.commit_sha && <Text color={green2}>{' · ' + phase.commit_sha.slice(0, 7)}</Text>}
                <Text color={dim}>{' · ' + phase.retry_count + ' retries'}</Text>
                <Text color={dim}>{' · ' + formatDuration(phase.started_at, phase.completed_at)}</Text>
                {phase.cost_usd != null && <Text color={dim}>{' · $' + phase.cost_usd.toFixed(3)}</Text>}
                {phase.tokens && (
                  <Text color={dim}>{
                    ' · ' + formatTokens(
                      (phase.tokens.input_tokens ?? 0) +
                      (phase.tokens.cache_read_input_tokens ?? 0) +
                      (phase.tokens.output_tokens ?? 0),
                    ) + ' tok'
                  }</Text>
                )}
                {phase.session_id && <Text color={dim}>{' · ' + phase.session_id.slice(0, 8) + '…'}</Text>}
              </Box>

              <Text>{''}</Text>

              {/* 2. Summary */}
              <Text color={dim}>{'Summary:'}</Text>
              <Text color={fg}>{phase.summary ?? '—'}</Text>

              <Text>{''}</Text>

              {/* 3. Commit message */}
              <Text color={dim}>{'Commit:'}</Text>
              <Text color={fg}>{phase.commit_message ?? '—'}</Text>

              <Text>{''}</Text>

              {/* 4. Notes for next phase */}
              <Text color={dim}>{'Notes for next:'}</Text>
              <Text color={fg}>{phase.notes_for_next_phase ?? '—'}</Text>

              <Text>{''}</Text>

              {/* 5. Session log */}
              <Text color={dim}>{'Session log:'}</Text>
              {phaseEvents.length === 0
                ? <Text color={dim2}>{'  (no events)'}</Text>
                : phaseEvents.map((ev, i) => {
                    let line = '';
                    if (ev.kind === 'edit') line = 'edit ' + ev.file;
                    else if (ev.kind === 'bash') line = 'bash ' + ev.command.slice(0, 40);
                    else if (ev.kind === 'commit') line = 'commit ' + ev.sha.slice(0, 7) + ' ' + ev.message.slice(0, 30);
                    else if (ev.kind === 'ok') line = 'ok $' + ev.costUsd.toFixed(3);
                    else if (ev.kind === 'error') line = 'error ' + ev.message.slice(0, 40);
                    else line = ev.kind;
                    return <Text key={i} color={dim2}>{' ' + line}</Text>;
                  })
              }

              <Text>{''}</Text>

              {/* 6. Stdout tail */}
              <Text color={dim}>{'Stdout tail:'}</Text>
              {logTail.length === 0
                ? <Text color={dim2}>{'  (no log)'}</Text>
                : logTail.map((line, i) => <Text key={i} color={dim2}>{' ' + line}</Text>)
              }
            </>
          ) : (
            <Text color={dim}>{'Select a phase'}</Text>
          )}
        </Box>
      </Box>

      {/* Footer keybinds */}
      <Box>
        <Text color={dim}>{'↑↓ phase  l log  e edit  r retry  s skip  d diff  '}</Text>
        <Text color={cyan}>{'Esc back'}</Text>
      </Box>
    </Box>
  );
}
