import React from 'react';
import { Box, Text } from 'ink';
import { Spinner } from './Spinner.js';
import { border, cyan, dim, dim2 } from '../theme.js';
import type { RunMeta, PhaseEntry } from '../../types/meta.js';
import type { ActivityEvent } from '../../events/types.js';

interface Props {
  runMeta: RunMeta | null;
  activePhase: PhaseEntry | null;
  events: ActivityEvent[];
  focused: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function phaseLabel(promptFile: string): string {
  const m = promptFile.match(/PHASE_(\d+)/i);
  return m ? m[1] ?? promptFile : promptFile;
}

export function ExecutingPane({ runMeta, activePhase, events, focused }: Props): React.ReactElement {
  const repoName = runMeta?.primary_repo_path.split('/').pop() ?? '';
  const title = 'EXECUTING' + (runMeta ? ' · ' + repoName : '');

  const phaseEvents = activePhase
    ? events.filter(
        e => e.runId === runMeta?.id && e.phaseNumber === activePhase.number &&
          (e.kind === 'edit' || e.kind === 'bash'),
      )
    : [];

  const toolCallCount = phaseEvents.length;

  const inputTokens = activePhase?.tokens?.input_tokens ?? 0;
  const cacheRead = activePhase?.tokens?.cache_read_input_tokens ?? 0;
  const cacheCreation = activePhase?.tokens?.cache_creation_input_tokens ?? 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={focused ? cyan : border} width={28}>
      <Text color={focused ? cyan : dim}>{title}</Text>
      {(!runMeta || !activePhase) ? (
        <Text color={dim}> idle</Text>
      ) : (
        <>
          <Text>{phaseLabel(activePhase.prompt_file)}</Text>
          <Text color={dim2}>{'session ' + (activePhase.session_id?.slice(0, 8) ?? '—') + '…'}</Text>
          <Text color={dim}>{'····················'}</Text>
          <Text>{'TOOL CALLS '}<Text color={cyan}>{String(toolCallCount)}</Text></Text>
          {[...phaseEvents].reverse().slice(0, 6).map((ev, i) => {
            if (ev.kind === 'edit') {
              const done = !ev.inProgress;
              return (
                <Text key={i}>
                  {done ? <Text color={dim2}>{'✓'}</Text> : <Spinner />}
                  <Text>{' edit ' + ev.file.slice(0, 14)}</Text>
                </Text>
              );
            } else if (ev.kind === 'bash') {
              const done = ev.durationMs != null;
              const dur = done ? ' ' + ev.durationMs + 'ms' : '';
              return (
                <Text key={i}>
                  {done ? <Text color={dim2}>{'✓'}</Text> : <Spinner />}
                  <Text>{' bash ' + ev.command.slice(0, 14) + dur}</Text>
                </Text>
              );
            }
            return null;
          })}
          <Text color={dim}>{'tokens ' + formatTokens(inputTokens + cacheRead) + ' + ' + formatTokens(cacheCreation)}</Text>
          <Text color={dim}>{'cost   $' + (activePhase.cost_usd ?? 0).toFixed(3) + ' phase'}</Text>
        </>
      )}
    </Box>
  );
}
