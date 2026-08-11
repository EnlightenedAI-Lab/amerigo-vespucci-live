#!/usr/bin/env node
/**
 * IQAI Control Tower bridge — GitHub issue queue to local Cursor Agent CLI.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadBridgeConfig } from './lib/control-tower/config.js';
import {
  ensureStateDirs,
  loadBridgeState,
  saveBridgeState,
  loadCursorSession,
  saveCursorSession,
  writeBridgePid,
  clearBridgePid,
  recoverStaleRunningMission,
  markIssueProcessed
} from './lib/control-tower/state.js';
import { validateMission } from './lib/control-tower/validator.js';
import {
  listOpenAgentIssues,
  updateIssueTitle,
  postIssueComments,
  getGhAuthStatus
} from './lib/control-tower/github.js';
import {
  getCursorAuthStatus,
  getCursorVersion,
  createCursorSession,
  runCursorMission,
  resolveAgentCommand
} from './lib/control-tower/cursor-agent.js';
import {
  extractMissionPrompt,
  MISSION_STATES,
  parseMissionTitle
} from './lib/control-tower/protocol.js';

const args = new Set(process.argv.slice(2));
const once = args.has('--once');
const validateOnly = args.has('--validate-only');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureCursorSession(config, stateDir) {
  let session = loadCursorSession(stateDir);
  if (session.sessionId) return session;
  if (config.dryRunAgentCommand) {
    session = {
      sessionId: 'mock-control-tower-session',
      label: config.sessionLabel,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    };
    saveCursorSession(stateDir, session);
    return session;
  }
  const agentCommand = resolveAgentCommand(config);
  session = await createCursorSession({
    agentCommand,
    workspace: config.repoRoot,
    label: config.sessionLabel
  });
  saveCursorSession(stateDir, session);
  return session;
}

async function executeMission(config, bridgeState, issue, stateDir) {
  const parsed = parseMissionTitle(issue.title);
  const missionTitle = parsed?.missionTitle || issue.title;
  const prompt = extractMissionPrompt(issue.body || '');
  if (!prompt) throw new Error('Mission prompt missing after validation');

  bridgeState.runningIssue = issue.number;
  bridgeState.runningStartedAt = new Date().toISOString();
  saveBridgeState(stateDir, bridgeState);

  await updateIssueTitle({
    repository: config.repository,
    issueNumber: issue.number,
    state: MISSION_STATES.RUNNING,
    missionTitle
  });

  const session = await ensureCursorSession(config, stateDir);
  const reportDir = join(config.reportsDir, `issue-${issue.number}`);
  mkdirSync(reportDir, { recursive: true });

  let agentResult;
  try {
    agentResult = await runCursorMission({
      config,
      prompt,
      sessionId: session.sessionId,
      issueNumber: issue.number,
      inboxDir: config.inboxDir
    });
  } catch (error) {
    agentResult = {
      ok: false,
      exitCode: 1,
      text: error.message,
      stderr: error.stderr || '',
      stdout: error.stdout || '',
      status: MISSION_STATES.FAILED,
      latencyMs: 0
    };
  }

  session.lastUsedAt = new Date().toISOString();
  saveCursorSession(stateDir, session);

  const finalState = agentResult.status || (agentResult.ok ? MISSION_STATES.COMPLETE : MISSION_STATES.FAILED);
  const comment = [
    '## IQAI Control Tower — Agent 1 Result',
    '',
    `**Status:** ${finalState}`,
    `**Issue:** #${issue.number}`,
    `**Latency:** ${agentResult.latencyMs} ms`,
    '',
    '---',
    '',
    agentResult.text || agentResult.stdout || '(no agent output)'
  ].join('\n');

  await postIssueComments({
    repository: config.repository,
    issueNumber: issue.number,
    body: comment,
    chunkSize: config.commentChunkChars
  });

  await updateIssueTitle({
    repository: config.repository,
    issueNumber: issue.number,
    state: finalState,
    missionTitle
  });

  writeFileSync(join(reportDir, 'result.json'), JSON.stringify({
    issueNumber: issue.number,
    finalState,
    agentResult: {
      ok: agentResult.ok,
      exitCode: agentResult.exitCode,
      status: agentResult.status,
      latencyMs: agentResult.latencyMs,
      promptPath: agentResult.promptPath
    },
    completedAt: new Date().toISOString()
  }, null, 2));
  writeFileSync(join(reportDir, 'output.txt'), agentResult.text || agentResult.stdout || '', 'utf8');

  markIssueProcessed(bridgeState, issue.number);
  bridgeState.runningIssue = null;
  bridgeState.runningStartedAt = null;
  bridgeState.lastCompletedIssue = issue.number;
  bridgeState.lastResult = {
    issueNumber: issue.number,
    status: finalState,
    at: new Date().toISOString()
  };
  saveBridgeState(stateDir, bridgeState);
  return { finalState, agentResult };
}

async function pollOnce(config, bridgeState, stateDir) {
  if (!config.enabled) return { action: 'disabled' };
  if (bridgeState.runningIssue) return { action: 'busy', issue: bridgeState.runningIssue };

  const issues = await listOpenAgentIssues(config.repository);
  const queued = issues
    .map((issue) => ({ issue, validation: validateMission(issue, config, bridgeState) }))
    .filter((entry) => entry.validation.ok)
    .sort((a, b) => a.issue.number - b.issue.number);

  if (!queued.length) return { action: 'idle', scanned: issues.length };

  const { issue } = queued[0];
  const result = await executeMission(config, bridgeState, issue, stateDir);
  return { action: 'executed', issue: issue.number, result };
}

async function main() {
  const config = loadBridgeConfig();
  ensureStateDirs(config.stateDir, config.reportsDir, config.inboxDir);

  let bridgeState = loadBridgeState(config.stateDir);
  bridgeState = recoverStaleRunningMission(bridgeState);
  saveBridgeState(config.stateDir, bridgeState);

  if (validateOnly) {
    const issues = await listOpenAgentIssues(config.repository);
    const report = issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      validation: validateMission(issue, config, bridgeState)
    }));
    console.log(JSON.stringify({ repository: config.repository, report }, null, 2));
    return;
  }

  writeBridgePid(config.stateDir, process.pid);
  const agentCommand = resolveAgentCommand(config);
  const [gh, cursor, version] = await Promise.all([
    getGhAuthStatus(),
    getCursorAuthStatus(agentCommand),
    getCursorVersion(agentCommand)
  ]);

  if (!gh.connected) {
    console.error('GitHub CLI not authenticated. Run: gh auth login');
    process.exit(1);
  }
  if (!config.dryRunAgentCommand && !cursor.authenticated) {
    console.error('Cursor Agent CLI not authenticated. Run: agent login');
    process.exit(1);
  }

  console.log(JSON.stringify({
    bridge: config.enabled ? 'ENABLED' : 'DISABLED',
    repository: config.repository,
    github: gh.username,
    cursor: { version, authenticated: cursor.authenticated },
    mode: once ? 'once' : 'daemon',
    pid: process.pid
  }));

  const shutdown = () => {
    clearBridgePid(config.stateDir);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  do {
    try {
      bridgeState = loadBridgeState(config.stateDir);
      const outcome = await pollOnce(config, bridgeState, config.stateDir);
      if (once) {
        console.log(JSON.stringify(outcome, null, 2));
        clearBridgePid(config.stateDir);
        return;
      }
      if (outcome.action === 'executed') {
        console.log(`[control-tower] executed issue #${outcome.issue} → ${outcome.result.finalState}`);
      }
    } catch (error) {
      console.error('[control-tower] poll error:', error.message);
      if (once) {
        clearBridgePid(config.stateDir);
        process.exit(1);
      }
    }
    if (!once) await sleep(config.pollIntervalMs);
  } while (!once);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
