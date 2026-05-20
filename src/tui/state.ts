export { STATE_TABLE, getStateInfo } from '../types/state.js';
import { getStateInfo } from '../types/state.js';
import type { RunStatus, PhaseStatus, StateInfo } from '../types/state.js';

export function getStateStyle(status: RunStatus | PhaseStatus): StateInfo {
  return getStateInfo(status);
}
