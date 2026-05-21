export type ActivityEventKind =
  | 'phase'
  | 'edit'
  | 'bash'
  | 'commit'
  | 'ok'
  | 'pause'
  | 'error'
  | 'limit';

export interface ActivityEventBase {
  kind: ActivityEventKind;
  timestamp: Date;
  runId: string;
  phaseNumber: number;
}

export interface PhaseEvent extends ActivityEventBase {
  kind: 'phase';
  phaseName: string;
}

export interface EditEvent extends ActivityEventBase {
  kind: 'edit';
  file: string;
  additions: number;
  deletions: number;
  inProgress: boolean;
  toolUseId: string;
}

export interface BashEvent extends ActivityEventBase {
  kind: 'bash';
  command: string;
  result?: string;
  durationMs?: number;
  toolUseId: string;
}

export interface CommitEvent extends ActivityEventBase {
  kind: 'commit';
  sha: string;
  message: string;
}

export interface OkEvent extends ActivityEventBase {
  kind: 'ok';
  summary: string;
  costUsd: number;
}

export interface PauseEvent extends ActivityEventBase {
  kind: 'pause';
}

export interface ErrorEvent extends ActivityEventBase {
  kind: 'error';
  message: string;
}

export interface LimitEvent extends ActivityEventBase {
  kind: 'limit';
  resumeAt: Date;
}

export interface TextEvent extends ActivityEventBase {
  kind: 'text';
  text: string;
}

export type ActivityEvent =
  | PhaseEvent
  | EditEvent
  | BashEvent
  | CommitEvent
  | OkEvent
  | PauseEvent
  | ErrorEvent
  | LimitEvent
  | TextEvent;
