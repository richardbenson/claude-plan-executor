import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import { QueuePane } from './components/QueuePane.js';
import { PhasesPane } from './components/PhasesPane.js';
import { ExecutingPane } from './components/ExecutingPane.js';
import { CommandBar } from './components/CommandBar.js';
import { CommandPalette } from './components/CommandPalette.js';
import { KillConfirmModal } from './components/KillConfirmModal.js';
import { Drilldown } from './Drilldown.js';
import { useQueueState } from './hooks/useQueueState.js';
import { activityBus } from '../events/bus.js';
import { readQueue, writeQueue } from '../storage/queue.js';
import { updateMeta, updatePhase, getLogsDir } from '../storage/meta.js';
import { borderHi, dim, dim2, cyan, fg } from './theme.js';
import type { ActivityEvent } from '../events/types.js';

interface Props {
  columns: number;
  rows: number;
}

function estimateDiskSize(worktreePath: string): string {
  try {
    const stat = fs.lstatSync(worktreePath);
    if (!stat) return '?MB';
    // rough estimate: just report directory exists
    return '~?MB';
  } catch {
    return '—';
  }
}

function StatusLine({
  columns, selectedRun, selectedPhaseIndex, allRuns,
}: {
  columns: number;
  selectedRun: import('../types/meta.js').RunMeta | null;
  selectedPhaseIndex: number;
  allRuns: import('../types/meta.js').RunMeta[];
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

  return (
    <Box flexDirection="column" width={columns}>
      <Text>
        <Text color={dim}>{'selected  '}</Text>
        <Text color={fg}>{repoName + '/' + selectedRun.plan_folder + ' · ' + selectedRun.status + ' · ' + posStr}</Text>
      </Text>
      <Text>
        <Text color={dim}>{'          worktree '}</Text>
        <Text color={dim2}>{selectedRun.id.slice(0, 8) + ' · ' + diskSize}</Text>
      </Text>
    </Box>
  );
}

export function Manage({ columns, rows }: Props): React.ReactElement {
  const qs = useQueueState();
  const [focusedPane, setFocusedPane] = useState<'queue' | 'phases' | 'executing'>('queue');
  const [selectedRunIndex, setSelectedRunIndex] = useState(0);
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState(0);
  const [showPalette, setShowPalette] = useState(false);
  const [killConfirm, setKillConfirm] = useState(false);
  const [drilldown, setDrilldown] = useState<{ runId: string; phaseNumber: number } | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);

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
      try { process.kill(pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch {} }, 5000);
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
        const q = readQueue();
        if (selectedRunIndex > 0) {
          const tmp = q.entries[selectedRunIndex - 1];
          const cur = q.entries[selectedRunIndex];
          if (tmp && cur) {
            q.entries[selectedRunIndex - 1] = cur;
            q.entries[selectedRunIndex] = tmp;
            writeQueue(q);
            setSelectedRunIndex(i => i - 1);
          }
        }
        break;
      }
      case 'queue-down': {
        const q = readQueue();
        if (selectedRunIndex < q.entries.length - 1) {
          const tmp = q.entries[selectedRunIndex + 1];
          const cur = q.entries[selectedRunIndex];
          if (tmp && cur) {
            q.entries[selectedRunIndex + 1] = cur;
            q.entries[selectedRunIndex] = tmp;
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
        Bun.spawn(['cpe', 'queue'], { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
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
          Bun.spawn([process.env['EDITOR'] ?? 'vi', selectedRun.worktree_path], {
            stdout: 'inherit', stderr: 'inherit', stdin: 'inherit',
          });
        }
        break;
      }
      case 'log': {
        if (selectedRun && selectedPhase) {
          const logFile = path.join(getLogsDir(selectedRun.id), 'phase-' + String(selectedPhase.number).padStart(2, '0') + '.log');
          Bun.spawn([process.env['PAGER'] ?? 'less', logFile], {
            stdout: 'inherit', stderr: 'inherit', stdin: 'inherit',
          });
        }
        break;
      }
    }
  }

  useInput((input, key) => {
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
      const q = readQueue();
      if (selectedRunIndex > 0) {
        const tmp = q.entries[selectedRunIndex - 1];
        const cur = q.entries[selectedRunIndex];
        if (tmp && cur) {
          q.entries[selectedRunIndex - 1] = cur;
          q.entries[selectedRunIndex] = tmp;
          writeQueue(q);
          setSelectedRunIndex(i => i - 1);
        }
      }
      return;
    }

    // Option+ArrowDown reorder down
    if (key.downArrow && key.meta) {
      const q = readQueue();
      if (selectedRunIndex < q.entries.length - 1) {
        const tmp = q.entries[selectedRunIndex + 1];
        const cur = q.entries[selectedRunIndex];
        if (tmp && cur) {
          q.entries[selectedRunIndex + 1] = cur;
          q.entries[selectedRunIndex] = tmp;
          writeQueue(q);
          setSelectedRunIndex(i => i + 1);
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

    if (input === 'R') {
      const run = qs.activeRun;
      const phase = qs.activePhase;
      if (!run || !phase) return;
      const pid = run.claude_pid;
      if (pid) {
        try { process.kill(pid, 'SIGTERM'); } catch {}
      }
      updatePhase(run.id, phase.number, { status: 'pending', retry_count: 0 });
      updateMeta(run.id, { status: 'queued' });
      return;
    }

    if (input === 'S') {
      const run = qs.activeRun;
      const phase = qs.activePhase;
      if (!run || !phase) return;
      updatePhase(run.id, phase.number, { status: 'failed', summary: 'skipped by user' });
      const nextPhase = run.phases.find(p => p.number > phase.number);
      if (nextPhase) {
        updatePhase(run.id, nextPhase.number, { status: 'pending' });
      }
      updateMeta(run.id, { status: 'queued' });
      return;
    }

    if (input === 'K') {
      if (qs.activeRun && qs.activePhase) setKillConfirm(true);
      return;
    }

    if (input === 'e') {
      if (selectedRun) {
        Bun.spawn([process.env['EDITOR'] ?? 'vi', selectedRun.worktree_path], {
          stdout: 'inherit', stderr: 'inherit', stdin: 'inherit',
        });
      }
      return;
    }

    if (input === 'l') {
      if (selectedRun && selectedPhase) {
        const logFile = path.join(getLogsDir(selectedRun.id), 'phase-' + String(selectedPhase.number).padStart(2, '0') + '.log');
        Bun.spawn([process.env['PAGER'] ?? 'less', logFile], {
          stdout: 'inherit', stderr: 'inherit', stdin: 'inherit',
        });
      }
      return;
    }

    if (input === ':') { setShowPalette(true); return; }

    if (input === 'a') {
      Bun.spawn(['cpe', 'queue'], { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
      return;
    }

    if (key.escape) {
      if (killConfirm) { setKillConfirm(false); return; }
      if (showPalette) { setShowPalette(false); return; }
      if (drilldown) { setDrilldown(null); return; }
    }
  });

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

  return (
    <Box flexDirection="column" width={columns} height={rows - 2}>
      {/* Triptych */}
      <Box flexDirection="row" flexGrow={1}>
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
        />
      </Box>

      {/* Status line */}
      <StatusLine
        columns={columns}
        selectedRun={selectedRun}
        selectedPhaseIndex={selectedPhaseIndex}
        allRuns={allRuns}
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
        />
      )}
      {killConfirm && qs.activeRun && qs.activePhase && (
        <KillConfirmModal
          runMeta={qs.activeRun}
          phaseEntry={qs.activePhase}
          elapsedMs={elapsedMs}
          onConfirm={handleKill}
          onCancel={() => setKillConfirm(false)}
        />
      )}
    </Box>
  );
}
