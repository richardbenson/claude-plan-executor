export type ActivityEventKind =
  | 'phase'
  | 'edit'
  | 'bash'
  | 'commit'
  | 'ok'
  | 'pause'
  | 'resume'
  | 'error'
  | 'limit'
  | 'text'
  | 'output';

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

export interface ResumeEvent extends ActivityEventBase {
  kind: 'resume';
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

/**
 * A single raw output line from a harness that has no structured JSONL stream
 * (opaque adapters). Emitted by the generic output-tail; consumed by the bench
 * TUI's bounded live pane and the activity-timeout (as activity).
 */
export interface OutputEvent extends ActivityEventBase {
  kind: 'output';
  line: string;
}

export type ActivityEvent =
  | PhaseEvent
  | EditEvent
  | BashEvent
  | CommitEvent
  | OkEvent
  | PauseEvent
  | ResumeEvent
  | ErrorEvent
  | LimitEvent
  | TextEvent
  | OutputEvent;
