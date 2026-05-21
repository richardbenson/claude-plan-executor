import React from 'react';
import { Box, Text } from 'ink';
import { StateChip } from './StateChip.js';
import { border, cyan, bgFloat, dim, yellow } from '../theme.js';
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

export function PhasesPane({ phases, selectedRun, selectedIndex, focused, isPaused }: Props): React.ReactElement {
  const title = 'PHASES' + (selectedRun ? ' · ' + selectedRun.plan_folder : '');

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
