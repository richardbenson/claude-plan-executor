import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { activityBus } from '../events/bus.js';
import { useQueueState } from './hooks/useQueueState.js';
import { WatchHero } from './components/WatchHero.js';
import { ActivityFeed } from './components/ActivityFeed.js';
import { WatchBottomStrip } from './components/WatchBottomStrip.js';
import { WatchPaused, UserPausedFooter } from './components/WatchPaused.js';
import { dim, dim2 } from './theme.js';
import type { ActivityEvent } from '../events/types.js';

interface Props {
  columns: number;
  rows: number;
}

function formatFooterDate(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const weekday = get('weekday').toLowerCase();
  const day = get('day');
  const month = get('month').toLowerCase();
  const time = `${get('hour')}:${get('minute')}:${get('second')}`;
  const tz = get('timeZoneName');
  return `${weekday} ${day} ${month} · ${time} ${tz}`;
}

function useFooterClock(): string {
  const [text, setText] = useState(formatFooterDate);
  useEffect(() => {
    const id = setInterval(() => setText(formatFooterDate()), 1000);
    return () => clearInterval(id);
  }, []);
  return text;
}

// Approximate fixed heights: header(1) + hero border+content(~8) + feed header(2) + strip(~7) + footer(1)
const FIXED_ROWS = 20;

export function Watch({ columns, rows }: Props): React.ReactElement {
  const queueState = useQueueState();
  const footerClock = useFooterClock();
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
      <Box flexDirection="column" width={columns}>
        <WatchPaused variant="limit" queueState={queueState} columns={columns} rows={rows} />
        <WatchBottomStrip queueState={queueState} columns={columns} />
        <Box justifyContent="space-between">
          <Text color={dim}>{footerClock}</Text>
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
    : (
      <Box justifyContent="space-between" width={columns}>
        <Text color={dim}>{footerClock}</Text>
        <Text color={dim2}> v manage  q quit</Text>
      </Box>
    );

  return (
    <Box flexDirection="column" width={columns}>
      {hero}

      <Box flexDirection="column">
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
