import React from 'react';
import { Text } from 'ink';

const BLOCKS = '▁▂▃▄▅▆▇█';

interface Props {
  data: number[];
  width: number;
  color?: string;
}

export function Sparkline({ data, width, color }: Props): React.ReactElement {
  if (data.length === 0) {
    return <Text color={color}>{' '.repeat(width)}</Text>;
  }

  const max = Math.max(...data);
  const chars = data.map(v => BLOCKS[max === 0 ? 0 : Math.round((v / max) * 7)]);

  // Truncate or right-pad to width
  while (chars.length < width) chars.push(' ');
  const line = chars.slice(0, width).join('');

  return <Text color={color}>{line}</Text>;
}
