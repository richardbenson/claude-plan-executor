import React from 'react';
import { Box, Text } from 'ink';
import { dim, yellow, fg, cyan } from '../theme.js';

interface Props {
  focusedPane: 'queue' | 'phases' | 'executing';
  queuePaused: boolean;
  sessionActive: boolean;
}

export function CommandBar({ queuePaused, sessionActive }: Props): React.ReactElement {
  const pauseLabel = queuePaused
    ? <Text color={yellow}>{'p RESUME'}</Text>
    : <Text color={dim}>{'p pause'}</Text>;

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={fg}>{'QUEUE  '}</Text>
        <Text color={dim}>{'↑↓ select  ⌥↑↓ reorder  ↵ phases  '}</Text>
        {pauseLabel}
        <Text color={dim}>{'  r remove  a add plan'}</Text>
      </Text>
      <Text>
        <Text color={fg}>{'RUN    '}</Text>
        <Text color={sessionActive ? dim : dim}>{'R retry phase  S skip phase  '}</Text>
        <Text color={sessionActive ? fg : dim}>{'K kill session'}</Text>
        <Text color={dim}>{'  e $EDITOR  l log  : palette'}</Text>
        {!sessionActive && <Text color={dim}>{'  [no session]'}</Text>}
      </Text>
    </Box>
  );
}
