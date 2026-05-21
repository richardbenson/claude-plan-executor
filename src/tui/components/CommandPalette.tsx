import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { bgFloat, bgHi, cyan, dim, dim2, fg } from '../theme.js';

interface PaletteCommand {
  category: 'queue' | 'run';
  name: string;
  description: string;
  action: string;
}

const COMMANDS: PaletteCommand[] = [
  { category: 'queue', name: 'move up', description: 'Move selected run earlier in queue', action: 'queue-up' },
  { category: 'queue', name: 'move down', description: 'Move selected run later in queue', action: 'queue-down' },
  { category: 'queue', name: 'pause/resume', description: 'Toggle queue pause', action: 'pause' },
  { category: 'queue', name: 'add plan', description: 'Interactively add a new plan to queue', action: 'add' },
  { category: 'queue', name: 'archive run', description: 'Hide run from all views (mark archived)', action: 'archive' },
  { category: 'queue', name: 'remove run', description: 'Remove selected run (keep worktree)', action: 'remove' },
  { category: 'queue', name: 'remove run + worktree', description: 'Remove run and delete worktree', action: 'remove-worktree' },
  { category: 'run', name: 'retry phase', description: 'Kill session and restart current phase', action: 'retry' },
  { category: 'run', name: 'skip phase', description: 'Mark phase failed, advance to next', action: 'skip' },
  { category: 'run', name: 'kill session', description: 'Confirm and kill the running session', action: 'kill' },
  { category: 'run', name: 'open worktree', description: 'Open worktree in $EDITOR', action: 'editor' },
  { category: 'run', name: 'tail phase log', description: 'Open phase log in $PAGER', action: 'log' },
  { category: 'run', name: 'open PR', description: 'Open pull request in browser', action: 'pr' },
];

interface Props {
  onClose: () => void;
  onRun: (command: string) => void;
  visible: boolean;
  columns: number;
}

export function CommandPalette({ onClose, onRun, visible, columns }: Props): React.ReactElement | null {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const modalWidth = 80;
  const marginLeft = Math.max(0, Math.floor((columns - modalWidth - 2) / 2));

  const filtered = COMMANDS.filter(
    c =>
      query === '' ||
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.description.toLowerCase().includes(query.toLowerCase()),
  );

  useInput((_input, key) => {
    if (!visible) return;
    if (key.escape) { onClose(); return; }
    if (key.upArrow) {
      setSelectedIdx(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIdx(i => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const cmd = filtered[selectedIdx];
      if (cmd) { onRun(cmd.action); onClose(); }
      return;
    }
  });

  if (!visible) return null;

  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={cyan}
        backgroundColor={bgFloat}
        width={modalWidth}
        height={26}
        overflow="hidden"
      >
        <Box>
          <Text color={cyan}>{': '}</Text>
          <TextInput value={query} onChange={v => { setQuery(v); setSelectedIdx(0); }} />
        </Box>
        <Text color={dim}>{'─'.repeat(78)}</Text>
        {filtered.map((cmd, i) => {
          const selected = i === selectedIdx;
          const catColor = cmd.category === 'queue' ? cyan : dim2;
          return (
            <Box key={cmd.action} backgroundColor={selected ? bgHi : undefined}>
              <Text>{selected ? '▶ ' : '  '}</Text>
              <Text color={catColor}>{cmd.category.padEnd(5)}</Text>
              <Text color={fg}>{' ' + cmd.name.padEnd(24)}</Text>
              <Text color={dim2}>{cmd.description}</Text>
            </Box>
          );
        })}
        {filtered.length === 0 && <Text color={dim}>{'  no commands match'}</Text>}
      </Box>
    </Box>
  );
}
