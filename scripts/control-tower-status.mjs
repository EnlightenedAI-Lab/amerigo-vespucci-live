#!/usr/bin/env node
/**
 * IQAI Control Tower bridge status.
 */
import { existsSync } from 'node:fs';
import { loadBridgeConfig } from './lib/control-tower/config.js';
import {
  loadBridgeState,
  loadCursorSession,
  readBridgePid,
  ensureStateDirs
} from './lib/control-tower/state.js';
import { listOpenAgentIssues, getGhAuthStatus } from './lib/control-tower/github.js';
import {
  getCursorAuthStatus,
  getCursorVersion,
  resolveAgentCommand,
  shouldUseMockAgent
} from './lib/control-tower/cursor-agent.js';
import { parseMissionTitle, MISSION_STATES } from './lib/control-tower/protocol.js';

function isProcessRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let config;
  try {
    config = loadBridgeConfig();
  } catch (error) {
    console.log(JSON.stringify({
      bridge: 'CONFIG_MISSING',
      error: error.message,
      hint: 'Copy control-tower/bridge.config.example.json to control-tower/bridge.config.json'
    }, null, 2));
    process.exit(1);
  }

  ensureStateDirs(config.stateDir, config.reportsDir, config.inboxDir);
  const bridgeState = loadBridgeState(config.stateDir);
  const session = loadCursorSession(config.stateDir);
  const pid = readBridgePid(config.stateDir);
  const daemonRunning = isProcessRunning(pid);
  const agentCommand = config.agentCommand || resolveAgentCommand(config);
  const productionAgent = config.agentCommand;
  const useMock = shouldUseMockAgent(config);

  const [gh, cursor, version, issues] = await Promise.all([
    getGhAuthStatus(),
    getCursorAuthStatus(agentCommand),
    getCursorVersion(config),
    config.repository ? listOpenAgentIssues(config.repository).catch(() => []) : Promise.resolve([])
  ]);

  const queued = issues.filter((issue) => parseMissionTitle(issue.title)?.state === MISSION_STATES.QUEUED);
  const currentIssue = bridgeState.runningIssue
    ? issues.find((issue) => issue.number === bridgeState.runningIssue)
    : null;

  const payload = {
    bridge: config.enabled ? (daemonRunning ? 'ENABLED (running)' : 'ENABLED (stopped)') : 'DISABLED',
    agent1: bridgeState.runningIssue ? 'RUNNING' : 'IDLE',
    currentIssue: currentIssue
      ? { number: currentIssue.number, title: currentIssue.title }
      : bridgeState.runningIssue
        ? { number: bridgeState.runningIssue, title: null }
        : null,
    queue: { count: queued.length, issues: queued.map((i) => i.number) },
    cursorSession: session.sessionId
      ? { bound: true, sessionId: session.sessionId, label: session.label }
      : { bound: false },
    github: gh.connected
      ? { connected: true, username: gh.username }
      : { connected: false },
    cursor: {
      installed: cursor.installed,
      authenticated: cursor.authenticated,
      version
    },
    productionAgent,
    mockUsedForProduction: useMock,
    readyForControlTowerMission: config.enabled
      && gh.connected
      && cursor.authenticated
      && !bridgeState.runningIssue
      && !useMock,
    lastResult: bridgeState.lastResult,
    pid: daemonRunning ? pid : null,
    configPath: config.configPath,
    configExists: existsSync(config.configPath)
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
