import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import * as path from 'path';
import { activityBus } from '../events/bus.js';
import { useQueueState } from './hooks/useQueueState.js';
import { WatchHero } from './components/WatchHero.js';
import { ActivityFeed } from './components/ActivityFeed.js';
import { WatchBottomStrip } from './components/WatchBottomStrip.js';
import { WatchPaused, UserPausedFooter } from './components/WatchPaused.js';
import { CommandPalette } from './components/CommandPalette.js';
import { QueueWizard } from './components/QueueWizard.js';
import { readQueue, writeQueue } from '../storage/queue.js';
import { updateMeta, updatePhase, getLogsDir } from '../storage/meta.js';
import { dim2, cyan, dim } from './theme.js';
import type { ActivityEvent } from '../events/types.js';

interface Props {
  columns: number;
  rows: number;
  compact?: boolean;
}

// Fixed rows consumed outside the ActivityFeed container:
// rows-1 outer offset(1) + hero with border(7) + strip(7) + footer(1) = 16
const FIXED_ROWS = 16;

export function Watch({ columns, rows, compact }: Props): React.ReactElement {
  const queueState = useQueueState();
  const [events, setEvents] = useState<ActivityEvent[]>(() => [...activityBus.getBuffer()]);
  const [showPalette, setShowPalette] = useState(false);
  const [showQueueWizard, setShowQueueWizard] = useState(false);

  useEffect(() => {
    const unsub = activityBus.subscribe(ev => {
      setEvents(prev => [...prev, ev]);
    });
    return unsub;
  }, []);

  useInput((input, key) => {
    if (key.escape && showPalette) { setShowPalette(false); return; }
    if (input === ':') { setShowPalette(true); return; }
  });

  function handlePaletteCommand(action: string) {
    const run = queueState.activeRun;
    switch (action) {
      case 'queue-up': {
        if (!run) break;
        const q = readQueue();
        const qi = q.entries.findIndex(e => e.run_id === run.id);
        if (qi > 0) {
          const tmp = q.entries[qi - 1];
          const cur = q.entries[qi];
          if (tmp && cur) {
            q.entries[qi - 1] = cur;
            q.entries[qi] = tmp;
            writeQueue(q);
          }
        }
        break;
      }
      case 'queue-down': {
        if (!run) break;
        const q = readQueue();
        const qi = q.entries.findIndex(e => e.run_id === run.id);
        if (qi !== -1 && qi < q.entries.length - 1) {
          const tmp = q.entries[qi + 1];
          const cur = q.entries[qi];
          if (tmp && cur) {
            q.entries[qi + 1] = cur;
            q.entries[qi] = tmp;
            writeQueue(q);
          }
        }
        break;
      }
      case 'pause': {
        const q = readQueue();
        writeQueue({ ...q, paused: !q.paused });
        break;
      }
      case 'add': {
        setShowQueueWizard(true);
        break;
      }
      case 'archive': {
        if (!run) break;
        const CANNOT_ARCHIVE = new Set(['executing', 'finalising', 'retrying', 'paused-limit']);
        if (CANNOT_ARCHIVE.has(run.status)) break;
        const qa = readQueue();
        qa.entries = qa.entries.filter(e => e.run_id !== run.id);
        writeQueue(qa);
        updateMeta(run.id, { status: 'archived' });
        break;
      }
      case 'remove': {
        if (run) {
          const q = readQueue();
          q.entries = q.entries.filter(e => e.run_id !== run.id);
          writeQueue(q);
        }
        break;
      }
      case 'remove-worktree': {
        if (run) {
          const q = readQueue();
          q.entries = q.entries.filter(e => e.run_id !== run.id);
          writeQueue(q);
        }
        break;
      }
      case 'retry': {
        const phase = queueState.activePhase;
        if (!run || !phase) break;
        const pid = run.claude_pid;
        if (pid) {
          try { process.kill(pid, 'SIGTERM'); } catch { }
        }
        updatePhase(run.id, phase.number, { status: 'pending', retry_count: 0 });
        updateMeta(run.id, { status: 'queued' });
        break;
      }
      case 'skip': {
        const phase = queueState.activePhase;
        if (!run || !phase) break;
        updatePhase(run.id, phase.number, { status: 'failed', summary: 'skipped by user' });
        const nextPhase = (run.phases ?? []).find(p => p.number > phase.number);
        if (nextPhase) {
          updatePhase(run.id, nextPhase.number, { status: 'pending' });
        }
        updateMeta(run.id, { status: 'queued' });
        break;
      }
      case 'kill': {
        if (!run) break;
        const pid = run.claude_pid;
        if (pid) {
          try { process.kill(pid, 'SIGTERM'); } catch { }
          setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch { } }, 5000);
        }
        const phase = queueState.activePhase;
        if (phase) updatePhase(run.id, phase.number, { status: 'failed' });
        updateMeta(run.id, { status: 'paused' });
        break;
      }
      case 'editor': {
        if (run) {
          // TODO: Launch editor subprocess
        }
        break;
      }
      case 'log': {
        const phase = queueState.activePhase;
        if (run && phase) {
          const logFile = path.join(getLogsDir(run.id), 'phase-' + String(phase.number).padStart(2, '0') + '.log');
          // TODO: Launch pager subprocess
        }
        break;
      }
      case 'pr': {
        if (run) {
          // TODO: Open PR in browser
        }
        break;
      }
    }
  }

  const feedRows = Math.max(2, rows - FIXED_ROWS);
  const activeSessionId = queueState.activeRun?.id;

  if (compact) {
    const { activeRun, activePhase } = queueState;
    const compactFeedRows = Math.max(2, rows - 6);
    return (
      <Box flexDirection="column" width={columns} height={rows - 1}>
        <Box flexDirection="row">
          {activeRun ? (
            <>
              <Text color={cyan}>{activeRun.plan_folder ?? ''}</Text>
              <Text color={dim}>{' phase ' + (activePhase?.number ?? '?') + '/' + (activeRun.phases ?? []).length}</Text>
            </>
          ) : (
            <Text color={dim}>idle — no active run</Text>
          )}
        </Box>
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          <ActivityFeed
            events={events}
            availableRows={compactFeedRows}
            columns={columns}
            activeSessionId={activeSessionId}
          />
        </Box>
        <Text color={dim2}> v manage  q quit</Text>
        {showPalette && (
          <CommandPalette
            visible={showPalette}
            onClose={() => setShowPalette(false)}
            onRun={action => { handlePaletteCommand(action); setShowPalette(false); }}
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

  // Limit-paused is full-screen replacement
  if (queueState.isLimitPaused) {
    return (
      <Box flexDirection="column" width={columns} height={rows - 1}>
        <WatchPaused variant="limit" queueState={queueState} columns={columns} rows={rows} />
        <WatchBottomStrip queueState={queueState} columns={columns} />
        <Box justifyContent="flex-end">
          <Text color={dim2}> v manage  q quit</Text>
        </Box>
      </Box>
    );
  }

  // User-paused: hero is replaced by paused variant
  const hero = queueState.isPaused
    ? <WatchPaused variant="user" queueState={queueState} columns={columns} rows={rows} />
    : <WatchHero queueState={queueState} columns={columns} />;

  const footer = queueState.isPaused
    ? <UserPausedFooter />
    : <Box justifyContent="flex-end"><Text color={dim2}> v manage  : palette  q quit</Text></Box>;

  return (
    <Box flexDirection="column" width={columns} height={rows - 1}>
      {hero}

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        <ActivityFeed
          events={events}
          availableRows={feedRows}
          columns={columns}
          activeSessionId={activeSessionId}
        />
      </Box>

      <WatchBottomStrip queueState={queueState} columns={columns} />

      {footer}

      {showPalette && (
        <CommandPalette
          visible={showPalette}
          onClose={() => setShowPalette(false)}
          onRun={action => { handlePaletteCommand(action); setShowPalette(false); }}
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
