import React from 'react';
import { Text } from 'ink';
import InkSpinner from 'ink-spinner';
import { cyan } from '../theme.js';

interface Props {
  color?: string;
}

export function Spinner({ color }: Props): React.ReactElement {
  return (
    <Text color={color ?? cyan}>
      <InkSpinner type="dots" />
    </Text>
  );
}
