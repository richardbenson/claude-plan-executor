import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { Header } from './components/Header.js';
import { Watch } from './Watch.js';
import { activityBus } from '../events/bus.js';
import { yellow, dim2 } from './theme.js';
import type { AppConfig } from '../types/meta.js';
import type { ActivityEvent } from '../events/types.js';

interface AppProps {
  config: AppConfig;
}

function useStdoutDimensions(): { columns: number; rows: number } {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  });

  useEffect(() => {
    if (!stdout) return;
    const handler = () => {
      setDimensions({ columns: stdout.columns, rows: stdout.rows });
    };
    stdout.on('resize', handler);
    return () => { stdout.off('resize', handler); };
  }, [stdout]);

  return dimensions;
}

function Manage({ columns, rows }: { columns: number; rows: number }): React.ReactElement {
  return (
    <Box width={columns} height={rows - 1}>
      <Text color={dim2}> Manage mode — coming in Phase 12 </Text>
    </Box>
  );
}

function QuitConfirmBar(): React.ReactElement {
  return (
    <Text color={yellow}> Really quit? Session is active. [y] quit  [n] cancel </Text>
  );
}

export function App({ config: _config }: AppProps): React.ReactElement {
  const { columns, rows } = useStdoutDimensions();
  const [mode, setMode] = useState<'watch' | 'manage'>('watch');
  const [sessionActive, setSessionActive] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    const unsub = activityBus.subscribe(event => {
      setEvents(prev => [...prev, event]);
      if (event.kind === 'phase') {
        setSessionActive(true);
      } else if (event.kind === 'ok' || event.kind === 'error') {
        setSessionActive(false);
      }
    });
    return unsub;
  }, []);

  useInput((input, key) => {
    if (showQuitConfirm) {
      if (input === 'y') process.exit(0);
      if (input === 'n') setShowQuitConfirm(false);
      return;
    }
    if (input === 'v') {
      setMode(m => m === 'watch' ? 'manage' : 'watch');
    } else if (input === 'q') {
      if (sessionActive) {
        setShowQuitConfirm(true);
      } else {
        process.exit(0);
      }
    }
  });

  const recentPhaseEvent = [...events].reverse().find(e => e.kind === 'phase');
  const queueStatusText = sessionActive || recentPhaseEvent ? 'queue running' : 'queue idle';

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Header
        mode={mode.toUpperCase() as 'WATCH' | 'MANAGE'}
        statusText={queueStatusText}
      />
      {showQuitConfirm && <QuitConfirmBar />}
      {mode === 'watch'
        ? <Watch columns={columns} rows={rows} />
        : <Manage columns={columns} rows={rows} />}
    </Box>
  );
}
