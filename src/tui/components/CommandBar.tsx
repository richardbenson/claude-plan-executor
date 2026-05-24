import React from 'react';
import { Box, Text } from 'ink';
import { dim, yellow, fg, cyan } from '../theme.js';

interface Props {
  focusedPane: 'queue' | 'phases' | 'executing';
  queuePaused: boolean;
  sessionActive: boolean;
}

export function CommandBar({ focusedPane, queuePaused, sessionActive }: Props): React.ReactElement {
  const pauseLabel = queuePaused
    ? <Text color={yellow}>{'p RESUME'}</Text>
    : <Text color={dim}>{'p pause'}</Text>;

  const queueLabelColor = focusedPane === 'queue' ? cyan : dim;
  const runLabelColor = focusedPane === 'executing' ? cyan : dim;

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={queueLabelColor} bold={'queue' === focusedPane}>{'QUEUE  '}</Text>
        <Text color={dim}>{'↑↓ select  ⌥↑↓ reorder  ↵ phases  '}</Text>
        {pauseLabel}
        <Text color={dim}>{'  d archive  a add plan'}</Text>
      </Text>
      <Text>
        <Text color={runLabelColor} bold={'executing' === focusedPane}>{'RUN    '}</Text>
        <Text color={sessionActive ? dim : dim}>{'R retry phase  S skip phase  '}</Text>
        <Text color={sessionActive ? fg : dim}>{'K kill session'}</Text>
        <Text color={dim}>{'  e $EDITOR  l log  : palette  q quit'}</Text>
        {!sessionActive && <Text color={dim}>{'  [no session]'}</Text>}
      </Text>
    </Box>
  );
}
