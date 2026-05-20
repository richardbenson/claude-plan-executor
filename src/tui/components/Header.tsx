import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { blue, borderHi, teal, orange, fgDark, dim } from '../theme.js';

interface Props {
  mode: 'WATCH' | 'MANAGE';
  statusText: string;
  elapsed?: number;
}

function formatDatetime(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const weekday = get('weekday').toLowerCase();
  const day = get('day');
  const month = get('month').toLowerCase();
  const time = `${get('hour')}:${get('minute')}`;
  const tz = get('timeZoneName');

  return `${weekday} ${day} ${month} · ${time} ${tz}`;
}

export function Header({ mode, statusText }: Props): React.ReactElement {
  const [datetime, setDatetime] = useState(formatDatetime());

  useEffect(() => {
    // Tick every minute — second-precision updates cause Ink to repaint the full
    // screen once per second, which produces a visible flicker at the bottom.
    const id = setInterval(() => setDatetime(formatDatetime()), 60_000);
    return () => clearInterval(id);
  }, []);

  const modeColor = mode === 'WATCH' ? teal : orange;

  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Box>
        <Text color={blue}>▮ cpe</Text>
        <Text color={borderHi}> · </Text>
        <Text color={modeColor} bold>{mode}</Text>
        <Text color={borderHi}> · </Text>
        <Text color={fgDark}>{statusText}</Text>
      </Box>
      <Text color={dim}>{datetime}</Text>
    </Box>
  );
}
