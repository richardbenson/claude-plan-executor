import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { QueuePane } from './components/QueuePane.js';
import { PhasesPane } from './components/PhasesPane.js';
import { ExecutingPane } from './components/ExecutingPane.js';
import { CommandBar } from './components/CommandBar.js';
import { CommandPalette } from './components/CommandPalette.js';
import { KillConfirmModal } from './components/KillConfirmModal.js';
import { Drilldown } from './Drilldown.js';
import { useQueueState } from './hooks/useQueueState.js';
import { useInteractiveSubprocess } from './SubprocessContext.js';
import { SubprocessOverlay } from './components/SubprocessOverlay.js';
import { QueueWizard } from './components/QueueWizard.js';
import { activityBus } from '../events/bus.js';
import { readQueue, writeQueue, enqueueFront } from '../storage/queue.js';
import { updateMeta, updatePhase, getLogsDir } from '../storage/meta.js';
import { borderHi, dim, dim2, cyan, fg, yellow } from './theme.js';
import type { ActivityEvent } from '../events/types.js';

interface Props {
  columns: number;
  rows: number;
  compact?: boolean;
}

function estimateDiskSize(worktreePath: string): string {
  try {
    const result = execSync('du -sh ' + JSON.stringify(worktreePath), {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return result.split('\t')[0]?.trim() ?? '?';
  } catch {
    return '?';
  }
}

function StatusLine({
  columns, selectedRun, selectedPhaseIndex, allRuns, isPaused,
}: {
  columns: number;
  selectedRun: import('../types/meta.js').RunMeta | null;
  selectedPhaseIndex: number;
  allRuns: import('../types/meta.js').RunMeta[];
  isPaused: boolean;
}): React.ReactElement {
  if (!selectedRun) {
    return (
      <Box width={columns}>
        <Text color={dim}>{'selected  —'}</Text>
      </Box>
    );
  }

  const repoName = selectedRun.primary_repo_path.split('/').pop() ?? selectedRun.primary_repo_path;
  const position = allRuns.findIndex(r => r.id === selectedRun.id) + 1;
  const posStr = position === 1 ? '1st' : position === 2 ? '2nd' : position === 3 ? '3rd' : position + 'th';
  const diskSize = estimateDiskSize(selectedRun.worktree_path);

  const remainingPhases = selectedRun
    ? (selectedRun.phases ?? []).filter(
        p => p.status !== 'complete' && p.status !== 'pr-created' && p.status !== 'failed',
      ).length
    : 0;
  const etaMin = remainingPhases * 5;
  const etaStr = remainingPhases > 0
    ? (etaMin >= 60
      ? `~${Math.floor(etaMin / 60)}h ${etaMin % 60}m`
      : `~${etaMin}m`)
    : '—';

  return (
    <Box flexDirection="column" width={columns}>
      <Text>
        <Text color={dim}>{'selected  '}</Text>
        <Text color={fg}>{repoName + '/' + (selectedRun.plan_folder ?? '') + ' · ' + selectedRun.status + ' · ' + posStr + ' · eta ' + etaStr}</Text>
        {isPaused && <Text color={yellow}>{'  ‖ paused'}</Text>}
      </Text>
      <Text>
        <Text color={dim}>{'          worktree '}</Text>
        <Text color={dim2}>{selectedRun.id.slice(0, 8) + ' · ' + diskSize}</Text>
      </Text>
    </Box>
  );
}

export function Manage({ columns, rows, compact }: Props): React.ReactElement {
  const qs = useQueueState();
  const [focusedPane, setFocusedPane] = useState<'queue' | 'phases' | 'executing'>('queue');
  const [selectedRunIndex, setSelectedRunIndex] = useState(0);
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState(0);
  const [showPalette, setShowPalette] = useState(false);
  const [killConfirm, setKillConfirm] = useState(false);
  const [drilldown, setDrilldown] = useState<{ runId: string; phaseNumber: number } | null>(null);
  const [overlay, setOverlay] = useState<{ command: string[]; title: string } | null>(null);
  const [showQueueWizard, setShowQueueWizard] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const runInteractive = useInteractiveSubprocess();

  useEffect(() => {
    const unsub = activityBus.subscribe(ev => setEvents(prev => [...prev, ev]));
    return unsub;
  }, []);

  const allRuns = qs.allRuns;
  const selectedRun = allRuns[selectedRunIndex] ?? null;
  const phasesForSelectedRun = selectedRun?.phases ?? [];
  const selectedPhase = phasesForSelectedRun[selectedPhaseIndex] ?? null;

  function handleKill() {
    const run = qs.activeRun;
    if (!run) { setKillConfirm(false); return; }
    const pid = run.claude_pid;
    if (pid) {
      try { process.kill(pid, 'SIGTERM'); } catch { }
      setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch { } }, 5000);
    }
    const phase = qs.activePhase;
    if (phase) {
      updatePhase(run.id, phase.number, { status: 'failed' });
    }
    updateMeta(run.id, { status: 'paused' });
    setKillConfirm(false);
  }

  function handlePaletteCommand(action: string) {
    switch (action) {
      case 'queue-up': {
        if (!selectedRun) break;
        const q = readQueue();
        const qi = q.entries.findIndex(e => e.run_id === selectedRun.id);
        if (qi > 0) {
          const tmp = q.entries[qi - 1];
          const cur = q.entries[qi];
          if (tmp && cur) {
            q.entries[qi - 1] = cur;
            q.entries[qi] = tmp;
            writeQueue(q);
            setSelectedRunIndex(i => i - 1);
          }
        }
        break;
      }
      case 'queue-down': {
        if (!selectedRun) break;
        const q = readQueue();
        const qi = q.entries.findIndex(e => e.run_id === selectedRun.id);
        if (qi !== -1 && qi < q.entries.length - 1) {
          const tmp = q.entries[qi + 1];
          const cur = q.entries[qi];
          if (tmp && cur) {
            q.entries[qi + 1] = cur;
            q.entries[qi] = tmp;
            writeQueue(q);
            setSelectedRunIndex(i => i + 1);
          }
        }
        break;
      }
      case 'pause': {
        const q = readQueue();
        writeQueue({ ...q, paused: !q.paused });
        activityBus.emit({ kind: 'pause', timestamp: new Date(), runId: selectedRun?.id ?? '', phaseNumber: 0 });
        break;
      }
      case 'add': {
        setShowQueueWizard(true);
        break;
      }
      case 'archive': {
        if (!selectedRun) break;
        const CANNOT_ARCHIVE = new Set(['executing', 'finalising', 'retrying', 'paused-limit']);
        if (CANNOT_ARCHIVE.has(selectedRun.status)) break;
        const qa = readQueue();
        qa.entries = qa.entries.filter(e => e.run_id !== selectedRun.id);
        writeQueue(qa);
        updateMeta(selectedRun.id, { status: 'archived' });
        setSelectedRunIndex(i => Math.max(0, i - 1));
        break;
      }
      case 'remove': {
        if (selectedRun) {
          const q = readQueue();
          q.entries = q.entries.filter(e => e.run_id !== selectedRun.id);
          writeQueue(q);
          setSelectedRunIndex(i => Math.max(0, i - 1));
        }
        break;
      }
      case 'kill': setKillConfirm(true); break;
      case 'editor': {
        if (selectedRun) {
          runInteractive([process.env['EDITOR'] ?? 'vi', selectedRun.worktree_path]);
        }
        break;
      }
      case 'log': {
        if (selectedRun && selectedPhase) {
          const logFile = path.join(getLogsDir(selectedRun.id), 'phase-' + String(selectedPhase.number).padStart(2, '0') + '.log');
          runInteractive([process.env['PAGER'] ?? 'less', logFile]);
        }
        break;
      }
    }
  }

  useInput((input, key) => {
    if (overlay || showQueueWizard) return;
    if (showPalette || killConfirm) return;
    if (drilldown) {
      if (key.escape) setDrilldown(null);
      return;
    }

    if (key.tab) {
      setFocusedPane(p => p === 'queue' ? 'phases' : p === 'phases' ? 'executing' : 'queue');
      return;
    }

    if (key.upArrow || input === 'k') {
      if (focusedPane === 'queue') setSelectedRunIndex(i => Math.max(0, i - 1));
      else if (focusedPane === 'phases') setSelectedPhaseIndex(i => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      if (focusedPane === 'queue') setSelectedRunIndex(i => Math.min(allRuns.length - 1, i + 1));
      else if (focusedPane === 'phases') setSelectedPhaseIndex(i => Math.min(phasesForSelectedRun.length - 1, i + 1));
      return;
    }

    // Option+ArrowUp reorder up
    if (key.upArrow && key.meta) {
      if (selectedRun) {
        const q = readQueue();
        const qi = q.entries.findIndex(e => e.run_id === selectedRun.id);
        if (qi > 0) {
          const tmp = q.entries[qi - 1];
          const cur = q.entries[qi];
          if (tmp && cur) {
            q.entries[qi - 1] = cur;
            q.entries[qi] = tmp;
            writeQueue(q);
            setSelectedRunIndex(i => i - 1);
          }
        }
      }
      return;
    }

    // Option+ArrowDown reorder down
    if (key.downArrow && key.meta) {
      if (selectedRun) {
        const q = readQueue();
        const qi = q.entries.findIndex(e => e.run_id === selectedRun.id);
        if (qi !== -1 && qi < q.entries.length - 1) {
          const tmp = q.entries[qi + 1];
          const cur = q.entries[qi];
          if (tmp && cur) {
            q.entries[qi + 1] = cur;
            q.entries[qi] = tmp;
            writeQueue(q);
            setSelectedRunIndex(i => i + 1);
          }
        }
      }
      return;
    }

    if (key.return) {
      if (focusedPane === 'queue' && selectedRun) {
        setSelectedPhaseIndex(0);
        setFocusedPane('phases');
      } else if (focusedPane === 'phases' && selectedRun && selectedPhase) {
        setDrilldown({ runId: selectedRun.id, phaseNumber: selectedPhase.number });
      }
      return;
    }

    if (input === 'p') {
      const q = readQueue();
      writeQueue({ ...q, paused: !q.paused });
      activityBus.emit({ kind: 'pause', timestamp: new Date(), runId: selectedRun?.id ?? '', phaseNumber: 0 });
      return;
    }

    if (input === 'd') {
      if (selectedRun) {
        const CANNOT_ARCHIVE = new Set(['executing', 'finalising', 'retrying', 'paused-limit']);
        if (!CANNOT_ARCHIVE.has(selectedRun.status)) {
          const q = readQueue();
          q.entries = q.entries.filter(e => e.run_id !== selectedRun.id);
          writeQueue(q);
          updateMeta(selectedRun.id, { status: 'archived' });
          setSelectedRunIndex(i => Math.max(0, i - 1));
        }
      }
      return;
    }

    if (input === 'R') {
      const run = qs.activeRun;
      const phase = qs.activePhase;
      if (!run || !phase) return;
      const pid = run.claude_pid;
      if (pid) {
        try { process.kill(pid, 'SIGTERM'); } catch { }
      }
      updatePhase(run.id, phase.number, { status: 'pending', retry_count: 0 });
      enqueueFront(run.id);
      updateMeta(run.id, { status: 'queued' });
      return;
    }

    if (input === 'S') {
      const run = qs.activeRun;
      const phase = qs.activePhase;
      if (!run || !phase) return;
      updatePhase(run.id, phase.number, { status: 'failed', summary: 'skipped by user' });
      const nextPhase = (run.phases ?? []).find(p => p.number > phase.number);
      if (nextPhase) {
        updatePhase(run.id, nextPhase.number, { status: 'pending' });
      }
      enqueueFront(run.id);
      updateMeta(run.id, { status: 'queued' });
      return;
    }

    if (input === 'K') {
      if (qs.activeRun && qs.activePhase) setKillConfirm(true);
      return;
    }

    if (input === 'e') {
      if (selectedRun) runInteractive([process.env['EDITOR'] ?? 'vi', selectedRun.worktree_path]);
      return;
    }

    if (input === 'l') {
      if (selectedRun && selectedPhase) {
        const logFile = path.join(getLogsDir(selectedRun.id), 'phase-' + String(selectedPhase.number).padStart(2, '0') + '.log');
        runInteractive([process.env['PAGER'] ?? 'less', logFile]);
      }
      return;
    }

    if (input === ':') { setShowPalette(true); return; }

    if (input === 'a') {
      setShowQueueWizard(true);
      return;
    }

    if (key.escape) {
      if (killConfirm) { setKillConfirm(false); return; }
      if (showPalette) { setShowPalette(false); return; }
      if (drilldown) { setDrilldown(null); return; }
    }
  });

  if (overlay) {
    return (
      <SubprocessOverlay
        command={overlay.command}
        title={overlay.title}
        onClose={() => setOverlay(null)}
        columns={columns}
        rows={rows}
      />
    );
  }

  if (drilldown) {
    return (
      <Drilldown
        runId={drilldown.runId}
        phaseNumber={drilldown.phaseNumber}
        onClose={() => setDrilldown(null)}
        columns={columns}
        rows={rows}
      />
    );
  }

  const sessionActive = !!(qs.activeRun && qs.activePhase);
  const elapsedMs = qs.activePhase?.started_at
    ? Date.now() - new Date(qs.activePhase.started_at).getTime()
    : 0;

  if (compact) {
    const paneHeight = rows - 3;
    let activePane: React.ReactElement;
    if (focusedPane === 'queue') {
      activePane = (
        <QueuePane
          runs={allRuns}
          selectedIndex={selectedRunIndex}
          focused={true}
          onSelect={setSelectedRunIndex}
        />
      );
    } else if (focusedPane === 'phases') {
      activePane = (
        <PhasesPane
          phases={phasesForSelectedRun}
          selectedRun={selectedRun}
          selectedIndex={selectedPhaseIndex}
          focused={true}
          onSelect={setSelectedPhaseIndex}
          isPaused={qs.isPaused}
        />
      );
    } else {
      activePane = (
        <ExecutingPane
          runMeta={qs.activeRun}
          activePhase={qs.activePhase}
          events={events}
          focused={true}
          isPaused={qs.isPaused}
        />
      );
    }

    return (
      <Box flexDirection="column" width={columns} height={rows - 1} overflow="hidden">
        <Box flexGrow={1} height={paneHeight}>
          {activePane}
        </Box>
        <Text color={dim}>
          {'selected  ' + (selectedRun ? (selectedRun.plan_folder ?? '') + ' · ' + selectedRun.status : '—')}
        </Text>
        <Text color={dim}>{'Tab pane  ↑↓ select  ↵ open  p pause  K kill  q quit'}</Text>
        {showPalette && (
          <CommandPalette
            visible={showPalette}
            onClose={() => setShowPalette(false)}
            onRun={handlePaletteCommand}
            columns={columns}
          />
        )}
        {killConfirm && qs.activeRun && qs.activePhase && (
          <KillConfirmModal
            runMeta={qs.activeRun}
            phaseEntry={qs.activePhase}
            elapsedMs={elapsedMs}
            onConfirm={handleKill}
            onCancel={() => setKillConfirm(false)}
            columns={columns}
          />
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={columns} height={rows - (qs.isPaused ? 3 : 2)} overflow="hidden">
      {/* Paused banner */}
      {qs.isPaused && (
        <Text color={yellow} dimColor>
          {'‖‖ QUEUE PAUSED · currently-executing phase finishes, then waits · press p to resume'}
        </Text>
      )}
      {/* Triptych */}
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        <QueuePane
          runs={allRuns}
          selectedIndex={selectedRunIndex}
          focused={focusedPane === 'queue'}
          onSelect={setSelectedRunIndex}
        />
        <Text color={borderHi}>{' · '}</Text>
        <PhasesPane
          phases={phasesForSelectedRun}
          selectedRun={selectedRun}
          selectedIndex={selectedPhaseIndex}
          focused={focusedPane === 'phases'}
          onSelect={setSelectedPhaseIndex}
          isPaused={qs.isPaused}
        />
        <Text color={borderHi}>{' · '}</Text>
        <ExecutingPane
          runMeta={qs.activeRun}
          activePhase={qs.activePhase}
          events={events}
          focused={focusedPane === 'executing'}
          isPaused={qs.isPaused}
        />
      </Box>

      {/* Status line */}
      <StatusLine
        columns={columns}
        selectedRun={selectedRun}
        selectedPhaseIndex={selectedPhaseIndex}
        allRuns={allRuns}
        isPaused={qs.isPaused}
      />

      {/* Command bar */}
      <CommandBar
        focusedPane={focusedPane}
        queuePaused={qs.isPaused}
        sessionActive={sessionActive}
      />

      {/* Modals */}
      {showPalette && (
        <CommandPalette
          visible={showPalette}
          onClose={() => setShowPalette(false)}
          onRun={handlePaletteCommand}
          columns={columns}
        />
      )}
      {killConfirm && qs.activeRun && qs.activePhase && (
        <KillConfirmModal
          runMeta={qs.activeRun}
          phaseEntry={qs.activePhase}
          elapsedMs={elapsedMs}
          onConfirm={handleKill}
          onCancel={() => setKillConfirm(false)}
          columns={columns}
        />
      )}
      {showQueueWizard && (
        <QueueWizard
          onClose={() => setShowQueueWizard(false)}
          columns={columns}
          rows={rows}
        />
      )}
    </Box>
  );
}
