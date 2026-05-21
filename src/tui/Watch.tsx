import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { activityBus } from '../events/bus.js';
import { useQueueState } from './hooks/useQueueState.js';
import { WatchHero } from './components/WatchHero.js';
import { ActivityFeed } from './components/ActivityFeed.js';
import { WatchBottomStrip } from './components/WatchBottomStrip.js';
import { WatchPaused, UserPausedFooter } from './components/WatchPaused.js';
import { CommandPalette } from './components/CommandPalette.js';
import { readQueue, writeQueue } from '../storage/queue.js';
import { updateMeta, updatePhase } from '../storage/meta.js';
import { dim2 } from './theme.js';
import type { ActivityEvent } from '../events/types.js';

interface Props {
  columns: number;
  rows: number;
}

// Approximate fixed heights: header(1) + hero border+content(~8) + feed header(2) + strip(~7) + footer(1)
const FIXED_ROWS = 20;

export function Watch({ columns, rows }: Props): React.ReactElement {
  const queueState = useQueueState();
  const [events, setEvents] = useState<ActivityEvent[]>(() => [...activityBus.getBuffer()]);
  const [showPalette, setShowPalette] = useState(false);

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
      case 'pause': {
        const q = readQueue();
        writeQueue({ ...q, paused: !q.paused });
        break;
      }
      case 'kill': {
        if (!run) break;
        const pid = run.claude_pid;
        if (pid) {
          try { process.kill(pid, 'SIGTERM'); } catch {}
          setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch {} }, 5000);
        }
        const phase = queueState.activePhase;
        if (phase) updatePhase(run.id, phase.number, { status: 'failed' });
        updateMeta(run.id, { status: 'paused' });
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
    }
  }

  const feedRows = Math.max(2, rows - FIXED_ROWS);
  const activeSessionId = queueState.activeRun?.id;

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

      <Box flexDirection="column" flexGrow={1}>
        <ActivityFeed
          events={events}
          availableRows={feedRows}
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
    </Box>
  );
}
