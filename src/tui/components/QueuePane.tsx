import React from 'react';
import { Box, Text } from 'ink';
import { StateChip } from './StateChip.js';
import { border, cyan, bgFloat, dim } from '../theme.js';
import type { RunMeta } from '../../types/meta.js';

interface Props {
  runs: RunMeta[];
  selectedIndex: number;
  focused: boolean;
  onSelect: (i: number) => void;
}

function progressBar(complete: number, total: number, width: number): string {
  if (total === 0) return ' '.repeat(width);
  const filled = Math.round((complete / total) * width);
  return '━'.repeat(filled) + '░'.repeat(width - filled);
}

export function QueuePane({ runs, selectedIndex, focused }: Props): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? cyan : border}
      width={16}
    >
      <Text color={focused ? cyan : dim}>{'QUEUE · ' + runs.length}</Text>
      {runs.map((run, i) => {
        const selected = i === selectedIndex;
        const repoName = run.primary_repo_path.split('/').pop() ?? run.primary_repo_path;
        const completePhases = run.phases.filter(p => p.status === 'complete' || p.status === 'pr-created').length;
        const totalPhases = run.phases.length;
        const isExecuting = run.status === 'executing' || run.status === 'retrying';

        return (
          <Box key={run.id} flexDirection="column" backgroundColor={selected ? bgFloat : undefined}>
            <Text>
              <Text color={selected ? cyan : undefined}>{'┃'}</Text>
              <Text>{(selected ? '▶ ' : '  ') + repoName.slice(0, 9)}</Text>
            </Text>
            <Text>
              <Text color={selected ? cyan : undefined}>{'┃'}</Text>
              <Text>{'  /' + run.plan_folder.slice(0, 10)}</Text>
            </Text>
            <Box flexDirection="row">
              <Text color={selected ? cyan : undefined}>{'┃'}</Text>
              <Text>{'  '}</Text>
              <StateChip status={run.status} showLabel={false} />
              <Text>{' ' + completePhases + '/' + totalPhases}</Text>
              {run.sandboxed && (
                <Box marginLeft={1} flexShrink={0}>
                  <Text color={dim}>{'⊡'}</Text>
                </Box>
              )}
            </Box>
            <Text>
              <Text color={selected ? cyan : undefined}>{'┃'}</Text>
              {isExecuting
                ? <Text color={cyan}>{'  ' + progressBar(completePhases, totalPhases, 8)}</Text>
                : <Text>{'        '}</Text>
              }
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
