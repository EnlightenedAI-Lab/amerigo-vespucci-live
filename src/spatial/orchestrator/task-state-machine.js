/**
 * TaskGraph V1 state transition enforcement.
 */
import { TASK_STATES, TERMINAL_TASK_STATES } from './contracts.js';

const ALLOWED_TRANSITIONS = Object.freeze({
  [TASK_STATES.PLANNED]: new Set([TASK_STATES.WAITING, TASK_STATES.READY, TASK_STATES.CANCELLED, TASK_STATES.SKIPPED]),
  [TASK_STATES.WAITING]: new Set([TASK_STATES.READY, TASK_STATES.CANCELLED, TASK_STATES.SKIPPED]),
  [TASK_STATES.READY]: new Set([TASK_STATES.RUNNING, TASK_STATES.CANCELLED, TASK_STATES.SKIPPED]),
  [TASK_STATES.RUNNING]: new Set([
    TASK_STATES.SUCCEEDED,
    TASK_STATES.DEGRADED,
    TASK_STATES.FAILED,
    TASK_STATES.PARTIAL,
    TASK_STATES.CANCELLED
  ]),
  [TASK_STATES.PARTIAL]: new Set([
    TASK_STATES.SUCCEEDED,
    TASK_STATES.DEGRADED,
    TASK_STATES.FAILED,
    TASK_STATES.CANCELLED
  ])
});

/**
 * @param {string} from
 * @param {string} to
 */
export function canTransitionTaskState(from, to) {
  if (from === to) return true;
  if (TERMINAL_TASK_STATES.has(from)) return false;
  return ALLOWED_TRANSITIONS[from]?.has(to) === true;
}

/**
 * @param {object} task
 * @param {string} nextState
 */
export function assertTaskStateTransition(task, nextState) {
  const current = task.state || TASK_STATES.PLANNED;
  if (!canTransitionTaskState(current, nextState)) {
    const err = new Error(`Invalid task state transition ${current} -> ${nextState}`);
    err.code = 'INVALID_TASK_STATE_TRANSITION';
    throw err;
  }
}

/**
 * @param {string} state
 */
export function isTerminalTaskState(state) {
  return TERMINAL_TASK_STATES.has(state);
}

/**
 * @param {string} dependencyType
 * @param {string[]} dependencyStates
 */
export function evaluateDependency(dependencyType, dependencyStates = []) {
  if (!dependencyStates.length) return dependencyType === 'SOFT_COMPLETE';
  switch (dependencyType) {
    case 'HARD_SUCCESS':
    case 'GATE':
      return dependencyStates.every((state) => state === TASK_STATES.SUCCEEDED);
    case 'ANY_SUCCESS':
      return dependencyStates.some((state) => state === TASK_STATES.SUCCEEDED || state === TASK_STATES.DEGRADED);
    case 'SOFT_COMPLETE':
      return dependencyStates.every((state) => isTerminalTaskState(state));
    case 'STREAM':
    case 'DATA_VERSION':
      return dependencyStates.some((state) => state === TASK_STATES.SUCCEEDED || state === TASK_STATES.PARTIAL);
    default:
      return false;
  }
}
