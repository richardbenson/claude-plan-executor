export type RunStatus =
  | 'queued'
  | 'executing'
  | 'retrying'
  | 'paused'
  | 'paused-limit'
  | 'finalising'
  | 'complete'
  | 'pr-created'
  | 'failed'
  | 'pending';

export type PhaseStatus =
  | 'queued'
  | 'executing'
  | 'retrying'
  | 'paused'
  | 'paused-limit'
  | 'finalising'
  | 'complete'
  | 'pr-created'
  | 'failed'
  | 'pending';

export interface StateInfo {
  glyph: string;
  color: string;
  label: string;
}

export const STATE_TABLE: Record<RunStatus | PhaseStatus, StateInfo> = {
  queued:       { glyph: '○', color: '#737aa2', label: 'queued' },
  executing:    { glyph: '◐', color: '#7dcfff', label: 'executing' },
  retrying:     { glyph: '↻', color: '#ff9e64', label: 'retrying' },
  paused:       { glyph: '⏸', color: '#e0af68', label: 'paused' },
  'paused-limit': { glyph: '◴', color: '#bb9af7', label: 'limit-wait' },
  finalising:   { glyph: '⤴', color: '#73daca', label: 'finalising' },
  complete:     { glyph: '●', color: '#9ece6a', label: 'complete' },
  'pr-created': { glyph: '✓', color: '#9ece6a', label: 'PR opened' },
  failed:       { glyph: '✕', color: '#f7768e', label: 'failed' },
  pending:      { glyph: '·', color: '#565f89', label: 'pending' },
};

export function getStateInfo(status: RunStatus | PhaseStatus): StateInfo {
  const info = STATE_TABLE[status];
  if (!info) throw new Error(`Unknown status: ${status}`);
  return info;
}
