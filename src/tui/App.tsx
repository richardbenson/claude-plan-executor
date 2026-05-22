import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { Header } from './components/Header.js';
import { Watch } from './Watch.js';
import { Manage } from './Manage.js';
import { SubprocessContext } from './SubprocessContext.js';
import { activityBus } from '../events/bus.js';
import { yellow } from './theme.js';
import { useQueueState } from './hooks/useQueueState.js';
import type { AppConfig } from '../types/meta.js';
import type { ActivityEvent } from '../events/types.js';

interface AppProps {
  config: AppConfig;
  onInteractiveSubprocess?: (cmd: string[]) => void;
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

function QuitConfirmBar(): React.ReactElement {
  return (
    <Text color={yellow}> Really quit? Session is active. [y] quit  [n] cancel </Text>
  );
}

export function App({ config: _config, onInteractiveSubprocess }: AppProps): React.ReactElement {
  const { columns, rows } = useStdoutDimensions();
  const compact = columns < 100 || rows < 30;
  const [mode, setMode] = useState<'watch' | 'manage'>('watch');
  const [sessionActive, setSessionActive] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [, setEvents] = useState<ActivityEvent[]>([]);
  const queueState = useQueueState();
  const sessionStartedAtRef = React.useRef<Date | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<Date | null>(null);

  useEffect(() => {
    const unsub = activityBus.subscribe(event => {
      setEvents(prev => [...prev, event]);
      if (event.kind === 'phase') {
        setSessionActive(true);
        if (!sessionStartedAtRef.current) {
          sessionStartedAtRef.current = event.timestamp;
          setSessionStartedAt(event.timestamp);
        }
      } else if (event.kind === 'ok' || event.kind === 'error') {
        setSessionActive(false);
      }
    });
    return unsub;
  }, []);

  useInput((input, _key) => {
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

  const queueStatusText = queueState.isLimitPaused
    ? 'queue paused · waiting on 5h limit window'
    : queueState.isPaused
    ? 'queue paused · by user'
    : sessionActive
    ? 'queue chewing'
    : 'queue idle';

  const subprocessContextValue = {
    runInteractive: onInteractiveSubprocess ?? (() => {}),
  };

  return (
    <SubprocessContext.Provider value={subprocessContextValue}>
      <Box flexDirection="column" width={columns} height={rows}>
        <Header
          mode={mode.toUpperCase() as 'WATCH' | 'MANAGE'}
          statusText={queueStatusText}
          sessionActive={sessionActive}
          startedAt={sessionStartedAt ?? undefined}
          compact={compact}
        />
        {showQuitConfirm && <QuitConfirmBar />}
        {mode === 'watch'
          ? <Watch columns={columns} rows={rows} compact={compact} />
          : <Manage columns={columns} rows={rows} compact={compact} />}
      </Box>
    </SubprocessContext.Provider>
  );
}
