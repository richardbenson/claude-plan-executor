import React from 'react';
import { Box, Text } from 'ink';
import { StateChip } from './StateChip.js';
import { border, cyan, magenta, bgFloat, dim } from '../theme.js';
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

const isSinglePrompt = (run: RunMeta): boolean => {
  return !run.plan_folder && !!run.prompt;
};

const getSourceLabel = (run: RunMeta): string => {
  if (!isSinglePrompt(run)) return '';
  switch (run.prompt_source) {
    case 'github-issue': return 'GH';
    case 'clipboard': return 'CLIP';
    case 'free-text':
    default: return 'TXT';
  }
};

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
        const single = isSinglePrompt(run);
        const completePhases = (run.phases ?? []).filter(p => p.status === 'complete' || p.status === 'pr-created').length;
        const totalPhases = (run.phases ?? []).length;
        const isExecuting = run.status === 'executing' || run.status === 'retrying';

        const barStr = single
          ? progressBar(isExecuting ? 1 : 0, 1, 8)
          : progressBar(completePhases, totalPhases, 8);

        return (
          <Box key={run.id} flexDirection="column" backgroundColor={selected ? bgFloat : undefined}>
            <Text>
              <Text color={selected ? cyan : undefined}>{'┃'}</Text>
              <Text>{(selected ? '▶ ' : '  ') + (single ? '★' : '') + repoName.slice(0, single ? 8 : 9)}</Text>
            </Text>
            <Text>
              <Text color={selected ? cyan : undefined}>{'┃'}</Text>
              {single
                ? <Text color={magenta}>{'  ' + getSourceLabel(run)}</Text>
                : <Text>{'  /' + (run.plan_folder ?? '').slice(0, 10)}</Text>
              }
            </Text>
            <Box flexDirection="row">
              <Text color={selected ? cyan : undefined}>{'┃'}</Text>
              <Text>{'  '}</Text>
              <StateChip status={run.status} showLabel={false} />
              {!single && <Text>{' ' + completePhases + '/' + totalPhases}</Text>}
              {run.sandboxed && (
                <Box marginLeft={1} flexShrink={0}>
                  <Text color={dim}>{'⊡'}</Text>
                </Box>
              )}
            </Box>
            <Text>
              <Text color={selected ? cyan : undefined}>{'┃'}</Text>
              {isExecuting
                ? <Text color={single ? magenta : cyan}>{'  ' + barStr}</Text>
                : <Text>{'        '}</Text>
              }
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
