import React from 'react';
import { Box, Text } from 'ink';
import {
  cyan, magenta, green, green2, yellow, red, dim, dim2, borderHi,
} from '../theme.js';
import type { ActivityEvent } from '../../events/types.js';

interface Props {
  events: ActivityEvent[];
  availableRows: number;
  columns: number;
  activeSessionId?: string;
}

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

interface RenderedEvent {
  key: string;
  glyph: string;
  color: string;
  kind: string;
  description: string;
  timestamp: Date;
  liveEdge?: boolean;
}

// EventRow prefix: HH:MM:SS(8) + 2sp + glyph(1) + sp + kind.padEnd(6)(6) + 2sp = 20 chars
const ROW_PREFIX = 20;

function renderEvent(ev: ActivityEvent, index: number, descWidth: number): RenderedEvent {
  const key = `${ev.kind}-${ev.timestamp.getTime()}-${ev.runId}-${ev.phaseNumber}-${index}`;
  switch (ev.kind) {
    case 'phase':
      return {
        key, color: cyan, glyph: '▸', kind: 'phase',
        description: `started phase ${ev.phaseNumber} — ${ev.phaseName}`.slice(0, descWidth),
        timestamp: ev.timestamp,
      };
    case 'edit':
      return {
        key, color: magenta, glyph: '✎', kind: 'edit',
        description: (ev.file + (ev.inProgress ? ' █' : (ev.additions > 0 || ev.deletions > 0 ? ` +${ev.additions} −${ev.deletions}` : ''))).slice(0, descWidth),
        timestamp: ev.timestamp,
        liveEdge: ev.inProgress,
      };
    case 'bash': {
      const full = ev.command + (ev.result ? ' → ' + ev.result : '');
      return {
        key, color: green, glyph: '$', kind: 'bash',
        description: full.slice(0, descWidth),
        timestamp: ev.timestamp,
      };
    }
    case 'commit':
      return {
        key, color: green2, glyph: '◆', kind: 'commit',
        description: (ev.sha.slice(0, 7) + ' · ' + ev.message).slice(0, descWidth),
        timestamp: ev.timestamp,
      };
    case 'text': {
      const firstLine = ev.text.split('\n')[0] ?? ev.text;
      return {
        key, color: dim, glyph: '»', kind: 'text',
        description: firstLine.slice(0, descWidth),
        timestamp: ev.timestamp,
      };
    }
    case 'ok': {
      const suffix = ` · $${ev.costUsd.toFixed(2)}`;
      const prefixStr = `phase ${ev.phaseNumber} complete — `;
      const summaryWidth = Math.max(0, descWidth - prefixStr.length - suffix.length);
      return {
        key, color: green, glyph: '✓', kind: 'ok',
        description: prefixStr + ev.summary.slice(0, summaryWidth) + suffix,
        timestamp: ev.timestamp,
      };
    }
    case 'pause':
      return {
        key, color: yellow, glyph: '‖', kind: 'pause',
        description: 'queue paused',
        timestamp: ev.timestamp,
      };
    case 'resume':
      return {
        key, color: green, glyph: '▶', kind: 'resume',
        description: 'queue unpaused',
        timestamp: ev.timestamp,
      };
    case 'error':
      return {
        key, color: red, glyph: '✕', kind: 'error',
        description: ev.message.slice(0, descWidth),
        timestamp: ev.timestamp,
      };
    case 'limit':
      return {
        key, color: magenta, glyph: '◴', kind: 'limit',
        description: ('session limit — resumes at ' + ev.resumeAt.toLocaleTimeString()).slice(0, descWidth),
        timestamp: ev.timestamp,
      };
  }
}

function EventRow({ ev }: { ev: RenderedEvent }): React.ReactElement {
  return (
    <Box>
      <Text color={dim}>{formatTime(ev.timestamp)}</Text>
      <Text>{'  '}</Text>
      <Text color={ev.color}>{ev.glyph}</Text>
      <Text>{' '}</Text>
      <Text color={dim2}>{ev.kind.padEnd(6)}</Text>
      <Text>{'  '}</Text>
      <Text color={ev.color}>{ev.description}</Text>
    </Box>
  );
}

export function ActivityFeed({ events, availableRows, columns, activeSessionId }: Props): React.ReactElement {
  const descWidth = Math.max(10, columns - ROW_PREFIX);
  // Most recent first
  const rendered = events.map((ev, i) => renderEvent(ev, i, descWidth)).reverse();

  const maxRows = Math.max(0, availableRows - 2);
  const visible = rendered.slice(0, maxRows);

  const isActive = !!activeSessionId;

  return (
    <Box flexDirection="column" height={availableRows} overflow="hidden">
      {/* Header */}
      <Box>
        {isActive ? (
          <>
            <Text color={dim} bold>LIVE ACTIVITY </Text>
            <Text color={green}>●</Text>
            <Text color={dim}> streaming session </Text>
            <Text color={green2}>{activeSessionId!.slice(0, 6)}…</Text>
          </>
        ) : (
          <>
            <Text color={dim}>○</Text>
            <Text color={dim}> no active session</Text>
          </>
        )}
      </Box>

      {/* Separator */}
      <Text color={borderHi}>{'·'.repeat(48)}</Text>

      {visible.length === 0 ? (
        <Text color={dim}> (no events yet) </Text>
      ) : (
        visible.map(ev => <EventRow key={ev.key} ev={ev} />)
      )}
    </Box>
  );
}
