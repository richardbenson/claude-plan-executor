import React from 'react';
import { Box, Text } from 'ink';
import * as path from 'path';
import { Sparkline } from './Sparkline.js';
import { activityBus } from '../../events/bus.js';
import {
  cyan, teal, yellow, magenta, border,
  dim, fg, fgDark,
} from '../theme.js';
import type { QueueState } from '../hooks/useQueueState.js';

interface Props {
  queueState: QueueState;
  columns: number;
}

function borderColorForState(state: QueueState): string {
  if (state.isLimitPaused) return magenta;
  if (state.isPaused) return yellow;
  const status = state.activeRun?.status;
  if (status === 'executing') return cyan;
  if (status === 'finalising') return teal;
  return border;
}

function buildHourlySparkline(): number[] {
  const slots = new Array<number>(18).fill(0);
  const now = new Date();
  for (const ev of activityBus.getBuffer()) {
    if (ev.kind !== 'ok') continue;
    const hoursAgo = (now.getTime() - ev.timestamp.getTime()) / 3_600_000;
    const idx = Math.floor(hoursAgo);
    if (idx >= 0 && idx < 18) {
      slots[17 - idx] = (slots[17 - idx] ?? 0) + ev.costUsd;
    }
  }
  return slots;
}

export function WatchHero({ queueState, columns }: Props): React.ReactElement {
  const { activeRun, activePhase } = queueState;
  const heroColor = borderColorForState(queueState);

  const rightColWidth = 28;
  const barWidth = Math.max(10, Math.min(40, columns - rightColWidth - 14));

  const totalPhases = activeRun?.phases.length ?? 0;
  const completedPhases = activeRun
    ? activeRun.phases.filter(
        p => p.status === 'complete' || p.status === 'pr-created',
      ).length
    : 0;

  const filledWidth = totalPhases > 0
    ? Math.round((completedPhases / totalPhases) * barWidth)
    : 0;
  const progressBar = '█'.repeat(filledWidth) + '░'.repeat(barWidth - filledWidth);

  const repoBasename = activeRun
    ? path.basename(activeRun.primary_repo_path)
    : null;

  const hourlyData = buildHourlySparkline();
  const runCount = queueState.allRuns.filter(r =>
    r.status === 'executing' || r.status === 'finalising' || r.status === 'complete' || r.status === 'pr-created',
  ).length;

  return (
    <Box borderStyle="round" borderColor={heroColor} flexDirection="row">
      {/* Left column */}
      <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
        {activeRun ? (
          <>
            <Text color={cyan} bold>NOW EXECUTING</Text>
            <Text color={fgDark}>{repoBasename} / {activeRun.plan_folder}</Text>
            <Text> </Text>
            <Text color={fg}>
              phase {activePhase?.number ?? '?'} / {totalPhases}
              {activePhase
                ? ` — ${activePhase.title ?? path.basename(activePhase.prompt_file, '.prompt.md').replace('PHASE_', 'phase ')}`
                : ''}
            </Text>
            <Text>{'plan '}<Text color={cyan}>{progressBar}</Text></Text>
          </>
        ) : (
          <>
            <Text color={dim} bold>IDLE</Text>
            <Text color={dim}>no active run</Text>
            <Text> </Text>
            <Text color={dim}>waiting for work</Text>
            <Text> </Text>
          </>
        )}
      </Box>

      {/* Right column */}
      <Box flexDirection="column" width={rightColWidth} paddingLeft={2}>
        <Text color={dim}>today's progress</Text>
        <Text color={fg}>{queueState.phasesCompleteToday} phases complete</Text>
        <Text> </Text>
        <Text color={dim}>budget today</Text>
        <Text color={yellow}>${queueState.budgetToday.toFixed(2)} across {Math.max(1, runCount)} runs</Text>
        <Box flexDirection="row">
          <Text color={dim}>cost/hour  </Text>
          <Sparkline data={hourlyData} width={10} color={yellow} />
        </Box>
      </Box>
    </Box>
  );
}
