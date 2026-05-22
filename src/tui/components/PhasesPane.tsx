import React from 'react';
import { Box, Text } from 'ink';
import { StateChip } from './StateChip.js';
import { border, cyan, bgFloat, dim, yellow, fg, green2 } from '../theme.js';
import type { RunMeta, PhaseEntry } from '../../types/meta.js';

interface Props {
  phases: PhaseEntry[];
  selectedRun: RunMeta | null;
  selectedIndex: number;
  focused: boolean;
  onSelect: (i: number) => void;
  isPaused: boolean;
}

function phaseLabel(promptFile: string): string {
  // PHASE_02.prompt.md → '02'
  const m = promptFile.match(/PHASE_(\d+)/i);
  return m ? m[1] ?? promptFile : promptFile;
}

function isSinglePrompt(run: RunMeta | null): boolean {
  return run !== null && !run.plan_folder && !!run.prompt;
}

function formatSource(source?: string): string {
  if (!source) return 'Unknown';
  switch (source) {
    case 'github-issue': return 'GitHub Issue';
    case 'clipboard': return 'Clipboard';
    case 'free-text':
    default: return 'Free Text';
  }
}

function truncatePrompt(prompt: string, maxLines = 6): string {
  const lines = prompt.split('\n');
  if (lines.length <= maxLines) return prompt;
  return lines.slice(0, maxLines).join('\n') + '…';
}

export function PhasesPane({ phases, selectedRun, selectedIndex, focused, isPaused }: Props): React.ReactElement {
  if (isSinglePrompt(selectedRun)) {
    const run = selectedRun!;
    const hasCost = run.total_cost_usd > 0;

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={focused ? cyan : border} flexGrow={1}>
        <Text color={focused ? cyan : dim}>{'DETAIL'}</Text>
        <Box>
          <Text color={dim}>{'Source  '}</Text>
          <Text color={fg}>{formatSource(run.prompt_source)}</Text>
        </Box>
        <Box>
          <Text color={dim}>{'Status  '}</Text>
          <StateChip status={run.status} showLabel={true} />
        </Box>
        {hasCost && (
          <Box>
            <Text color={dim}>{'Cost    '}</Text>
            <Text color={fg}>{'$' + run.total_cost_usd.toFixed(4)}</Text>
          </Box>
        )}
        {run.pr_url && (
          <Box>
            <Text color={dim}>{'PR      '}</Text>
            <Text color={green2}>{run.pr_url}</Text>
          </Box>
        )}
        {run.prompt && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={dim}>{'Prompt'}</Text>
            <Text color={fg}>{truncatePrompt(run.prompt, 6)}</Text>
          </Box>
        )}
      </Box>
    );
  }

  const title = 'PHASES' + (selectedRun ? ' · ' + (selectedRun.plan_folder ?? '') : '');

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={focused ? cyan : border} flexGrow={1}>
      <Text color={focused ? cyan : dim}>{title}</Text>
      {isPaused && (
        <Text color={yellow} dimColor>{'  queue paused — phases will not start'}</Text>
      )}
      {phases.map((phase, i) => {
        const selected = i === selectedIndex;
        const label = phase.title ?? phaseLabel(phase.prompt_file);
        const costStr = phase.cost_usd != null ? '  $' + phase.cost_usd.toFixed(3) : '';

        return (
          <Box key={phase.number} backgroundColor={selected ? bgFloat : undefined}>
            <StateChip status={phase.status} showLabel={false} />
            <Text>{' ' + String(phase.number).padStart(2, '0') + ' ' + label + costStr}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
