import React from 'react';
import { Text } from 'ink';
import { getStateStyle } from '../state.js';
import type { RunStatus, PhaseStatus } from '../../types/state.js';

interface Props {
  status: RunStatus | PhaseStatus;
  showLabel?: boolean;
}

export function StateChip({ status, showLabel = true }: Props): React.ReactElement {
  const info = getStateStyle(status);
  return (
    <Text color={info.color}>
      {info.glyph}{showLabel ? ' ' + info.label : ''}
    </Text>
  );
}
