import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import * as path from 'path';
import figlet from 'figlet';
import { StateChip } from './StateChip.js';
import { yellow, magenta, dim, dim2, fg, fgDark } from '../theme.js';
import type { QueueState } from '../hooks/useQueueState.js';
import { activityBus } from '../../events/bus.js';

function formatAgo(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

function getPausedAgo(): string | null {
  const buf = activityBus.getBuffer();
  for (let i = buf.length - 1; i >= 0; i--) {
    const ev = buf[i];
    if (ev?.kind === 'pause') {
      return formatAgo(Date.now() - ev.timestamp.getTime());
    }
  }
  return null;
}

interface Props {
  variant: 'user' | 'limit';
  queueState: QueueState;
  columns: number;
  rows: number;
}

function formatCountdownLabel(ms: number): string {
  if (ms <= 0) return '0m';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor((ms % 60_000) / 1000);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function UserPausedHero({ queueState }: { queueState: QueueState }): React.ReactElement {
  const queuedCount = queueState.queuedRuns.length;
  const phasesWaiting = queueState.queuedRuns.reduce(
    (acc, r) => acc + r.phases.filter(p =>
      p.status !== 'complete' && p.status !== 'pr-created' && p.status !== 'failed',
    ).length,
    0,
  );

  return (
    <Box borderStyle="round" borderColor={yellow} flexDirection="row">
      <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
        <Text color={yellow} bold>{'‖ QUEUE PAUSED · by user' + (getPausedAgo() ? ' · ' + getPausedAgo() : '')}</Text>
        <Text color={fgDark}>FINISHING THIS PHASE, THEN STOPPING</Text>
        <Text> </Text>
        <Text color={dim}>the current phase will complete normally</Text>
        <Text color={dim}>no new phases will start until resumed</Text>
      </Box>
      <Box flexDirection="column" width={32} paddingLeft={2}>
        <Text color={dim}>queued behind:</Text>
        <Text color={fg}>{queuedCount} runs · {phasesWaiting} phases waiting</Text>
        <Text> </Text>
        <Text color={dim2}>none will start while paused</Text>
      </Box>
    </Box>
  );
}

function LimitPausedFull({ queueState, columns }: { queueState: QueueState; columns: number }): React.ReactElement {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const msUntil = queueState.limitResumeAt
    ? Math.max(0, queueState.limitResumeAt.getTime() - now.getTime())
    : 0;

  const countdownLabel = formatCountdownLabel(msUntil);
  let bigText: string;
  try {
    bigText = figlet.textSync(countdownLabel, { font: 'Small' });
  } catch {
    bigText = countdownLabel;
  }

  const resumeStr = queueState.limitResumeAt
    ? queueState.limitResumeAt.toLocaleTimeString()
    : 'unknown';

  const allWaiting = [
    ...(queueState.activeRun ? [queueState.activeRun] : []),
    ...queueState.queuedRuns,
  ];

  const rightColWidth = Math.floor(columns / 3);

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={magenta} flexDirection="row">
        {/* Left: huge countdown */}
        <Box flexDirection="column" flexGrow={1} paddingLeft={1} paddingTop={1}>
          <Text color={magenta}>{bigText}</Text>
          <Text> </Text>
          <Text color={magenta} bold>WAITING FOR WINDOW RESET</Text>
          <Text color={dim}>resumes at {resumeStr}</Text>
        </Box>

        {/* Right: window usage */}
        <Box flexDirection="column" width={rightColWidth} paddingLeft={2} paddingTop={1}>
          <Text color={magenta} bold>window usage 100%</Text>
          <Text color={magenta}>{'▰'.repeat(14)}</Text>
          <Text> </Text>
          <Text color={dim2}>api_error_status: 429</Text>
          <Text color={dim}>5h rolling window exhausted</Text>
          <Text color={dim}>will auto-resume</Text>
        </Box>
      </Box>

      {/* What's waiting */}
      <Box flexDirection="column" paddingLeft={1} marginTop={1}>
        <Text color={dim} bold>WHAT'S WAITING</Text>
        {allWaiting.length === 0 ? (
          <Text color={dim}>(nothing queued)</Text>
        ) : (
          allWaiting.map(run => {
            const remaining = run.phases.filter(p =>
              p.status !== 'complete' && p.status !== 'pr-created' && p.status !== 'failed',
            ).length;
            const repo = path.basename(run.primary_repo_path);
            return (
              <Box key={run.id}>
                <StateChip status={run.status} showLabel={true} />
                <Text color={fgDark}> {repo}/{run.plan_folder}</Text>
                <Text color={dim}> · {remaining} phases remaining</Text>
              </Box>
            );
          })
        )}
      </Box>

      {/* While you wait */}
      <Box flexDirection="column" paddingLeft={1} marginTop={1}>
        <Text color={dim} bold>WHILE YOU WAIT</Text>
        <Text color={dim2}>{'· cpe will auto-resume when the window resets'}</Text>
        <Text color={dim2}>{'· the current phase (if any) has been stopped and will retry'}</Text>
        {queueState.limitResumeAt && (
          <Text color={dim2}>{'· check back at ' + queueState.limitResumeAt.toLocaleTimeString()}</Text>
        )}
      </Box>
    </Box>
  );
}

export function WatchPaused({ variant, queueState, columns }: Props): React.ReactElement {
  if (variant === 'limit') {
    return <LimitPausedFull queueState={queueState} columns={columns} />;
  }
  return <UserPausedHero queueState={queueState} />;
}

export function UserPausedFooter(): React.ReactElement {
  return (
    <Text color={yellow}>‖ queue paused — no runs will start until resumed</Text>
  );
}
