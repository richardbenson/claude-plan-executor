import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner } from './Spinner.js';
import { border, cyan, dim, dim2, fg, green, red } from '../theme.js';

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const MAX_LINES = 200;

interface Props {
  command: string[];
  title?: string;
  onClose: () => void;
  columns: number;
  rows: number;
}

export function SubprocessOverlay({ command, title, onClose, columns, rows }: Props): React.ReactElement {
  const [lines, setLines] = useState<string[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);

  useEffect(() => {
    const proc = Bun.spawn(command, {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'pipe',
    });

    const decoder = new TextDecoder();

    async function readStream(stream: ReadableStream<Uint8Array>) {
      const reader = stream.getReader();
      let partial = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = partial + decoder.decode(value, { stream: true });
          const parts = chunk.split('\n');
          partial = parts.pop() ?? '';
          const cleaned = parts.map(l => l.replace(ANSI_RE, ''));
          setLines(prev => [...prev, ...cleaned].slice(-MAX_LINES));
        }
        if (partial) {
          setLines(prev => [...prev, partial.replace(ANSI_RE, '')].slice(-MAX_LINES));
        }
      } catch { /* stream closed */ }
    }

    Promise.all([
      readStream(proc.stdout),
      readStream(proc.stderr),
    ]).then(async () => {
      const code = await proc.exited;
      setExitCode(code);
    });

    return () => {
      try { proc.kill(); } catch {}
    };
  }, []);

  useInput((_input, key) => {
    if (exitCode !== null) { onClose(); return; }
    if (key.escape) { onClose(); }
  });

  const displayTitle = title ?? command[0] ?? 'subprocess';
  const visibleRows = rows - 6;
  const visibleLines = lines.slice(-visibleRows);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={exitCode === null ? cyan : exitCode === 0 ? green : red}
      width={columns - 2}
      height={rows - 2}
    >
      {/* Title bar */}
      <Box>
        {exitCode === null && <Spinner />}
        {exitCode !== null && (
          <Text color={exitCode === 0 ? green : red}>
            {exitCode === 0 ? '✓' : '✕'}
          </Text>
        )}
        <Text color={fg}>{' ' + displayTitle + ' '}</Text>
        {exitCode === null && <Text color={dim}>{'running…'}</Text>}
        {exitCode !== null && (
          <Text color={dim}>{' exited ' + exitCode + ' · press any key to close'}</Text>
        )}
      </Box>

      <Text color={border}>{'─'.repeat(columns - 4)}</Text>

      {/* Output lines */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleLines.length === 0 && exitCode === null && (
          <Text color={dim2}>{'  waiting for output…'}</Text>
        )}
        {visibleLines.map((line, i) => (
          <Text key={i} color={fgMute} wrap="truncate">{line}</Text>
        ))}
      </Box>
    </Box>
  );
}

// Local import to avoid circular
const fgMute = '#9aa5ce';
