import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync
} from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = 'bridge-state.json';
const SESSION_FILE = 'cursor-session.json';
const PID_FILE = 'bridge.pid';

/**
 * @param {string} stateDir
 */
export function ensureStateDirs(stateDir, reportsDir, inboxDir) {
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(inboxDir, { recursive: true });
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

/**
 * @param {string} stateDir
 */
export function loadBridgeState(stateDir) {
  const path = join(stateDir, STATE_FILE);
  return readJson(path, {
    version: 1,
    processedIssueNumbers: [],
    runningIssue: null,
    runningStartedAt: null,
    lastResult: null,
    lastCompletedIssue: null,
    recoveredIssues: []
  });
}

/**
 * @param {string} stateDir
 * @param {object} state
 */
export function saveBridgeState(stateDir, state) {
  writeJson(join(stateDir, STATE_FILE), state);
}

/**
 * @param {string} stateDir
 */
export function loadCursorSession(stateDir) {
  return readJson(join(stateDir, SESSION_FILE), {
    sessionId: null,
    label: null,
    createdAt: null,
    lastUsedAt: null
  });
}

/**
 * @param {string} stateDir
 * @param {object} session
 */
export function saveCursorSession(stateDir, session) {
  writeJson(join(stateDir, SESSION_FILE), session);
}

/**
 * @param {string} stateDir
 * @param {number} pid
 */
export function writeBridgePid(stateDir, pid) {
  writeFileSync(join(stateDir, PID_FILE), String(pid));
}

/**
 * @param {string} stateDir
 */
export function readBridgePid(stateDir) {
  const path = join(stateDir, PID_FILE);
  if (!existsSync(path)) return null;
  const value = Number(readFileSync(path, 'utf8').trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * @param {string} stateDir
 */
export function clearBridgePid(stateDir) {
  const path = join(stateDir, PID_FILE);
  if (existsSync(path)) unlinkSync(path);
}

/**
 * @param {object} state
 * @param {number} issueNumber
 */
export function markIssueProcessed(state, issueNumber) {
  const set = new Set(state.processedIssueNumbers || []);
  set.add(issueNumber);
  state.processedIssueNumbers = [...set];
}

/**
 * @param {object} state
 * @param {number} issueNumber
 */
export function isIssueProcessed(state, issueNumber) {
  return (state.processedIssueNumbers || []).includes(issueNumber);
}

/**
 * Recover stale RUNNING missions after crash/restart.
 * @param {object} state
 */
export function recoverStaleRunningMission(state) {
  if (!state.runningIssue) return state;
  const recovered = {
    issueNumber: state.runningIssue,
    startedAt: state.runningStartedAt,
    recoveredAt: new Date().toISOString(),
    reason: 'UNKNOWN_TERMINATION_AFTER_RESTART'
  };
  state.recoveredIssues = [...(state.recoveredIssues || []), recovered];
  state.lastResult = {
    issueNumber: state.runningIssue,
    status: 'NEEDS_CONTROL_TOWER',
    at: recovered.recoveredAt,
    reason: recovered.reason
  };
  state.runningIssue = null;
  state.runningStartedAt = null;
  return state;
}
