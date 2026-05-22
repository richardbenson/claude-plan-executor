import React from 'react';
import { Box, Text, useInput } from 'ink';
import { red, bgFloat, dim2, fg } from '../theme.js';
import type { RunMeta, PhaseEntry } from '../../types/meta.js';

interface Props {
  runMeta: RunMeta;
  phaseEntry: PhaseEntry;
  elapsedMs: number;
  onConfirm: () => void;
  onCancel: () => void;
  columns: number;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m + 'm ' + rem + 's';
}

function phaseLabel(promptFile: string): string {
  const m = promptFile.match(/PHASE_(\d+)/i);
  return m ? m[1] ?? promptFile : promptFile;
}

export function KillConfirmModal({ runMeta, phaseEntry, elapsedMs, onConfirm, onCancel, columns }: Props): React.ReactElement {
  const modalWidth = 56;
  const marginLeft = Math.max(0, Math.floor((columns - modalWidth - 2) / 2));

  useInput((input, key) => {
    if (input === 'K') { onConfirm(); return; }
    if (input === 'n' || key.escape) { onCancel(); return; }
  });

  const repoName = runMeta.primary_repo_path.split('/').pop() ?? runMeta.primary_repo_path;
  const phaseName = phaseLabel(phaseEntry.prompt_file);
  const sessionId = phaseEntry.session_id?.slice(0, 8) ?? '—';
  const costSoFar = (phaseEntry.cost_usd ?? 0).toFixed(3);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={red}
      backgroundColor={bgFloat}
      width={modalWidth}
      marginTop={6}
      marginLeft={marginLeft}
    >
      <Text color={red}>{'⚠ KILL SESSION'}</Text>
      <Text>{''}</Text>
      <Text color={fg}>{'Force-kill the running phase?'}</Text>
      <Text>{''}</Text>
      <Text><Text color={dim2}>{'run     '}</Text><Text>{repoName + ' · ' + (runMeta.plan_folder ?? '')}</Text></Text>
      <Text><Text color={dim2}>{'phase   '}</Text><Text>{phaseName}</Text></Text>
      <Text><Text color={dim2}>{'session '}</Text><Text>{sessionId + '…'}</Text></Text>
      <Text><Text color={dim2}>{'elapsed '}</Text><Text>{formatDuration(elapsedMs) + ' · $' + costSoFar + ' spent so far'}</Text></Text>
      <Text>{''}</Text>
      <Text color={fg}>{'This will:'}</Text>
      <Text color={dim2}>{'  · send SIGTERM to claude, then SIGKILL after 5s'}</Text>
      <Text color={dim2}>{'  · mark phase ' + phaseName + ' failed, do NOT retry'}</Text>
      <Text color={dim2}>{'  · pause the run; queue advances to next'}</Text>
      <Text>{''}</Text>
      <Text>{'                              '}<Text color={dim2}>{'[n] cancel    '}</Text><Text color={red}>{'[K] kill'}</Text></Text>
    </Box>
  );
}
