/**
 * Activity-based run guard: keeps a run alive as long as the harness produces
 * *new* output, and aborts (timeout) only after a window of no new activity, or
 * after an optional absolute cap, or on a manual bail. The abort is surfaced via
 * an AbortSignal the dispatch site passes into the harness, which kills the
 * whole process tree (see proc-tree.ts).
 *
 * Repeat suppression: a stuck/looping harness that spams the *same* line must
 * not keep itself alive. Heuristic — an activity signature identical to the
 * immediately-preceding one does NOT reset the inactivity timer. This covers the
 * observed runaway (one line repeated for minutes); genuinely new output always
 * counts.
 */

export type AbortReason = 'timeout-inactivity' | 'timeout-maxruntime' | 'bailed';

export interface RunGuardOptions {
  /** No-new-activity window in ms. <= 0 / undefined disables the inactivity timer. */
  inactivityMs?: number;
  /** Absolute wall-clock cap in ms. <= 0 / undefined disables it. */
  maxRuntimeMs?: number;
}

export class RunGuard {
  readonly controller = new AbortController();
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private maxRuntimeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSignature: string | null = null;
  private _reason: AbortReason | null = null;
  private readonly inactivityMs: number;
  private readonly maxRuntimeMs: number;
  private started = false;
  private disposed = false;

  constructor(opts: RunGuardOptions = {}) {
    this.inactivityMs = opts.inactivityMs && opts.inactivityMs > 0 ? opts.inactivityMs : 0;
    this.maxRuntimeMs = opts.maxRuntimeMs && opts.maxRuntimeMs > 0 ? opts.maxRuntimeMs : 0;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** The reason the guard aborted, or null if it never did. */
  get reason(): AbortReason | null {
    return this._reason;
  }

  /** Map the abort reason to a terminal RunMeta outcome. */
  get outcome(): 'timeout' | 'bailed' | null {
    if (this._reason === 'bailed') return 'bailed';
    if (this._reason) return 'timeout';
    return null;
  }

  /** Begin the timers. Call once, right before launching the harness. */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.armInactivity();
    if (this.maxRuntimeMs) {
      this.maxRuntimeTimer = setTimeout(() => this.abort('timeout-maxruntime'), this.maxRuntimeMs);
    }
  }

  /**
   * Record a unit of harness activity. `signature` should identify the line/event
   * so repeats can be detected. Resets the inactivity timer only for genuinely
   * new activity.
   */
  noteActivity(signature: string): void {
    if (this.disposed || this.controller.signal.aborted) return;
    const isRepeat = signature === this.lastSignature;
    this.lastSignature = signature;
    if (!isRepeat) this.armInactivity();
  }

  /** Manual bail (e.g. TUI keybind). Aborts and records 'bailed'. */
  bail(): void {
    this.abort('bailed');
  }

  /** Stop all timers. Safe to call multiple times. */
  dispose(): void {
    this.disposed = true;
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    if (this.maxRuntimeTimer) clearTimeout(this.maxRuntimeTimer);
    this.inactivityTimer = null;
    this.maxRuntimeTimer = null;
  }

  private armInactivity(): void {
    if (!this.inactivityMs) return;
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => this.abort('timeout-inactivity'), this.inactivityMs);
  }

  private abort(reason: AbortReason): void {
    if (this.controller.signal.aborted) return;
    this._reason = reason;
    this.dispose();
    this.controller.abort(reason);
  }
}

// --- bail registry: lets an external caller (the Phase 06 TUI keybind) stop the
// currently-running combo. The dispatch registers its guard under the runId. ---

const bailRegistry = new Map<string, RunGuard>();

export function registerGuard(runId: string, guard: RunGuard): void {
  bailRegistry.set(runId, guard);
}

export function unregisterGuard(runId: string): void {
  bailRegistry.delete(runId);
}

/** Request a bail for a run. Returns true if a live guard was found and signalled. */
export function requestBail(runId: string): boolean {
  const guard = bailRegistry.get(runId);
  if (!guard) return false;
  guard.bail();
  return true;
}
