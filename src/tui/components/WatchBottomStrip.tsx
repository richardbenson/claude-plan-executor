import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import * as path from 'path';
import { Sparkline } from './Sparkline.js';
import { StateChip } from './StateChip.js';
import {
  dim, dim2, fg, green, green2, teal, orange, red, yellow, magenta, borderHi,
} from '../theme.js';
import type { QueueState } from '../hooks/useQueueState.js';

interface Props {
  queueState: QueueState;
  columns: number;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'window open';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m until reset`;
  if (m > 0) return `${m}m ${s}s until reset`;
  return `${s}s until reset`;
}

function UpNext({ queueState, colWidth }: { queueState: QueueState; colWidth: number }): React.ReactElement {
  const next3 = queueState.queuedRuns.slice(0, 3);
  // estimate ETA: each remaining phase ≈ 5 minutes
  let etaMin = 0;
  for (const run of queueState.queuedRuns) {
    const remaining = run.phases.filter(p =>
      p.status !== 'complete' && p.status !== 'pr-created' && p.status !== 'failed',
    ).length;
    etaMin += remaining * 5;
  }
  const etaStr = queueState.queuedRuns.length === 0
    ? 'ETA unknown'
    : `queue ETA ${String(Math.floor(etaMin / 60)).padStart(2, '0')}:${String(etaMin % 60).padStart(2, '0')}`;

  return (
    <Box flexDirection="column" width={colWidth}>
      <Text color={dim} bold>UP NEXT</Text>
      {next3.length === 0 ? (
        <Text color={dim}>(queue empty)</Text>
      ) : (
        next3.map((run, i) => {
          const repo = path.basename(run.primary_repo_path);
          const label = `${repo}/${run.plan_folder}`.slice(0, 14);
          return (
            <Box key={run.id}>
              <Text color={dim2}>{String(i + 1).padStart(2)} </Text>
              <StateChip status="queued" showLabel={false} />
              <Text color={fg}> {label}</Text>
            </Box>
          );
        })
      )}
      <Text color={dim}>{etaStr}</Text>
    </Box>
  );
}

function LimitWindow({ queueState, colWidth }: { queueState: QueueState; colWidth: number }): React.ReactElement {
  // Only tick when there is an active countdown — avoids re-renders when idle.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!queueState.limitResumeAt) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [Boolean(queueState.limitResumeAt)]);

  const msUntil = queueState.limitResumeAt
    ? queueState.limitResumeAt.getTime() - now.getTime()
    : -1;

  const countdownStr = queueState.limitResumeAt
    ? formatCountdown(msUntil)
    : 'window open';

  const resetStr = queueState.limitResumeAt
    ? 'resets ' + queueState.limitResumeAt.toLocaleTimeString()
    : '';

  return (
    <Box flexDirection="column" width={colWidth}>
      <Text color={dim} bold>LIMIT WINDOW</Text>
      <Text color={magenta}>{countdownStr}</Text>
      <Text color={dim}>{'▰▰▰▰▰▱▱▱▱▱▱▱▱▱'}<Text color={dim2}> 0% used</Text></Text>
      {resetStr ? <Text color={dim}>{resetStr}</Text> : <Text color={dim}>no limit active</Text>}
      <Box>
        <Text color={dim}>tokens this window  </Text>
        <Sparkline data={[0]} width={8} color={dim2} />
      </Box>
    </Box>
  );
}

function Today({ queueState, colWidth }: { queueState: QueueState; colWidth: number }): React.ReactElement {
  return (
    <Box flexDirection="column" width={colWidth}>
      <Text color={dim} bold>TODAY</Text>
      <Text color={green}>✓ {String(queueState.phasesCompleteToday).padEnd(3)} phases done</Text>
      <Text color={green2}>◆ {String(queueState.commitsToday).padEnd(3)} commits pushed</Text>
      <Text color={teal}>▸ {String(queueState.prsToday).padEnd(3)} PRs opened</Text>
      <Text color={orange}>↻ {String(queueState.retriesToday).padEnd(3)} phase retried</Text>
      <Text color={red}>✕ {String(queueState.failuresToday).padEnd(3)} failures</Text>
    </Box>
  );
}

export function WatchBottomStrip({ queueState, columns }: Props): React.ReactElement {
  const colWidth = Math.floor(columns / 3);
  const divider = ' · ';

  return (
    <Box flexDirection="column">
      <Text color={borderHi}>{'─'.repeat(columns)}</Text>
      <Box flexDirection="row">
        <UpNext queueState={queueState} colWidth={colWidth} />
        <Text color={borderHi}>{divider}</Text>
        <LimitWindow queueState={queueState} colWidth={colWidth} />
        <Text color={borderHi}>{divider}</Text>
        <Today queueState={queueState} colWidth={colWidth} />
      </Box>
    </Box>
  );
}
