import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { activityBus } from '../events/bus.js';
import { useQueueState } from './hooks/useQueueState.js';
import { WatchHero } from './components/WatchHero.js';
import { ActivityFeed } from './components/ActivityFeed.js';
import { WatchBottomStrip } from './components/WatchBottomStrip.js';
import { WatchPaused, UserPausedFooter } from './components/WatchPaused.js';
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

  useEffect(() => {
    const unsub = activityBus.subscribe(ev => {
      setEvents(prev => [...prev, ev]);
    });
    return unsub;
  }, []);

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
    : <Box justifyContent="flex-end"><Text color={dim2}> v manage  q quit</Text></Box>;

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
    </Box>
  );
}
