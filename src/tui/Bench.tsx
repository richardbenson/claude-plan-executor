import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { activityBus } from '../events/bus.js';
import { useBenchState } from './hooks/useBenchState.js';
import { getStateStyle } from './state.js';
import { requestBail } from '../runner/run-guard.js';
import { cyan, green, dim, dim2, red, yellow, borderHi, fg } from './theme.js';
import type { ActivityEvent } from '../events/types.js';

interface Props {
  columns: number;
  rows: number;
  compact?: boolean;
}

interface LiveLine {
  key: string;
  color: string;
  text: string;
  at: number;
}

// Fixed rows consumed by chrome around the bounded live pane:
// matrix header(1) + matrix rows are themselves bounded, "NOW" line(1),
// pane border(2) + footer(1) + spacing. We compute the live pane height from
// what's left and clamp it so one chatty harness can never blow up the layout.
const MAX_LIVE_ROWS = 14;
const MAX_MATRIX_ROWS = 12;

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s <= 0) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s ago`;
}

/** Collapse any activity event into a single coloured live-pane line. */
function formatLive(ev: ActivityEvent, descWidth: number): { color: string; text: string } {
  switch (ev.kind) {
    case 'output':
      return { color: fg, text: ev.line.slice(0, descWidth) };
    case 'text':
      return { color: dim2, text: ('» ' + (ev.text.split('\n')[0] ?? '')).slice(0, descWidth) };
    case 'edit':
      return { color: '#bb9af7', text: ('✎ ' + ev.file + (ev.inProgress ? ' █' : '')).slice(0, descWidth) };
    case 'bash':
      return { color: green, text: ('$ ' + ev.command + (ev.result ? ' → ' + ev.result : '')).slice(0, descWidth) };
    case 'commit':
      return { color: '#41a6b5', text: ('◆ ' + ev.sha.slice(0, 7) + ' ' + ev.message).slice(0, descWidth) };
    case 'ok':
      return { color: green, text: ('✓ ' + ev.summary).slice(0, descWidth) };
    case 'error':
      return { color: red, text: ('✕ ' + ev.message).slice(0, descWidth) };
    default:
      return { color: dim, text: String(ev.kind) };
  }
}

export function Bench({ columns, rows, compact }: Props): React.ReactElement {
  const bench = useBenchState();
  const [lines, setLines] = useState<LiveLine[]>([]);
  const [lastOutputAt, setLastOutputAt] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirmBail, setConfirmBail] = useState(false);
  const [bailNote, setBailNote] = useState<string | null>(null);

  const activeRunId = bench.active?.runId ?? null;
  const activeRef = useRef<string | null>(null);
  const descWidth = Math.max(10, columns - 4);

  // Reset the live pane + timers whenever the executing combo changes.
  useEffect(() => {
    if (activeRunId !== activeRef.current) {
      activeRef.current = activeRunId;
      setLines([]);
      setLastOutputAt(null);
      setStartedAt(activeRunId ? Date.now() : null);
      setConfirmBail(false);
    }
  }, [activeRunId]);

  // Subscribe once; keep only the active run's lines, bounded to the last N.
  useEffect(() => {
    const unsub = activityBus.subscribe(ev => {
      if (!activeRef.current || ev.runId !== activeRef.current) return;
      if (ev.kind === 'phase' || ev.kind === 'pause' || ev.kind === 'resume' || ev.kind === 'limit') {
        setLastOutputAt(Date.now());
        return;
      }
      const { color, text } = formatLive(ev, descWidth);
      if (!text.trim()) return;
      const at = ev.timestamp.getTime();
      setLastOutputAt(Date.now());
      setLines(prev => {
        const nextArr = [...prev, { key: `${ev.kind}-${at}-${prev.length}`, color, text, at }];
        return nextArr.slice(-MAX_LIVE_ROWS);
      });
    });
    return unsub;
  }, [descWidth]);

  // 1s clock so elapsed + last-output age advance even when no events arrive.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useInput((input, key) => {
    if (confirmBail) {
      if (input === 'y') {
        const ok = activeRunId ? requestBail(activeRunId) : false;
        setBailNote(ok ? `bail requested for ${bench.active?.combo ?? activeRunId}` : 'no live run to bail');
        setConfirmBail(false);
      } else if (input === 'n' || key.escape) {
        setConfirmBail(false);
      }
      return;
    }
    if (input === 'b' && activeRunId) {
      setConfirmBail(true);
    }
  });

  const liveRows = compact ? Math.max(3, rows - 12) : Math.min(MAX_LIVE_ROWS, Math.max(4, rows - 14));
  const matrixRows = bench.combos.slice(0, MAX_MATRIX_ROWS);
  const elapsedMs = startedAt ? now - startedAt : 0;
  const ageMs = lastOutputAt ? now - lastOutputAt : null;
  const quiet = ageMs !== null && ageMs > 10_000;

  return (
    <Box flexDirection="column" width={columns} height={rows - 1}>
      {/* Matrix header + progress counters */}
      <Box>
        <Text color={dim} bold>MATRIX </Text>
        <Text color={dim2}>{bench.total} run{bench.total === 1 ? '' : 's'} · </Text>
        <Text color={green}>{bench.done} done</Text>
        <Text color={dim2}> · </Text>
        <Text color={cyan}>{bench.running} running</Text>
        <Text color={dim2}> · </Text>
        <Text color={dim2}>{bench.pending} pending</Text>
      </Box>

      {bench.total === 0 ? (
        <Text color={dim}> (no bench runs — enqueue some with `cpe bench …`) </Text>
      ) : (
        matrixRows.map(c => {
          const st = getStateStyle(c.status);
          const trailing =
            c.status === 'executing' ? `${fmtElapsed(elapsedMs)}`
            : c.durationMs ? fmtElapsed(c.durationMs)
            : '';
          return (
            <Box key={c.runId}>
              <Text color={st.color}>{st.glyph}</Text>
              <Text>{' '}</Text>
              <Text color={c.status === 'executing' ? cyan : fg}>{c.combo.padEnd(Math.min(46, descWidth - 24))}</Text>
              <Text color={dim2}>{' ' + st.label.padEnd(10)}</Text>
              <Text color={dim}>{trailing}</Text>
            </Box>
          );
        })
      )}
      {bench.combos.length > MAX_MATRIX_ROWS && (
        <Text color={dim}> …and {bench.combos.length - MAX_MATRIX_ROWS} more</Text>
      )}

      {/* NOW line: current combo + elapsed + last-output age (quiet harness aware) */}
      <Box marginTop={1}>
        {bench.active ? (
          <>
            <Text color={dim} bold>NOW </Text>
            <Text color={cyan}>{bench.active.combo}</Text>
            <Text color={dim2}>{'  elapsed '}</Text>
            <Text color={fg}>{fmtElapsed(elapsedMs)}</Text>
            <Text color={dim2}>{'  ·  last output '}</Text>
            <Text color={quiet ? yellow : dim2}>{ageMs === null ? '—' : fmtAge(ageMs)}</Text>
          </>
        ) : (
          <Text color={dim}>no bench run executing</Text>
        )}
      </Box>

      {/* Bounded live pane — fixed height, oldest lines scroll out the top. */}
      <Box flexDirection="column" borderStyle="round" borderColor={borderHi} height={liveRows + 2} overflow="hidden">
        {lines.length === 0 ? (
          <Text color={dim}>
            {bench.active
              ? (quiet ? ` quiet — no output for ${fmtAge(ageMs ?? 0)}` : ' waiting for output…')
              : ' (idle)'}
          </Text>
        ) : (
          lines.slice(-liveRows).map(l => (
            <Text key={l.key} color={l.color} wrap="truncate-end">{l.text}</Text>
          ))
        )}
      </Box>

      {/* Footer / bail confirm */}
      {confirmBail ? (
        <Text color={red}> Bail {bench.active?.combo ?? 'run'}? Process-tree-kill, record as bailed, capture + continue. [y] bail  [n] cancel </Text>
      ) : (
        <Box justifyContent="space-between">
          <Text color={dim2}>{bailNote ? ` ${bailNote}` : ''}</Text>
          <Text color={dim2}>{bench.active ? 'b bail  ' : ''}v watch  q quit </Text>
        </Box>
      )}
    </Box>
  );
}
