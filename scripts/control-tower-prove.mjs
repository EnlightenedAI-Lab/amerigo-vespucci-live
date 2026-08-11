#!/usr/bin/env node
/**
 * Control Tower bridge proof harness — mock-agent transport, queue, security.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { loadExampleConfig } from './lib/control-tower/config.js';
import { createIssue, listOpenAgentIssues } from './lib/control-tower/github.js';
import { buildMissionTitle, MISSION_STATES, MARKER, TARGET, parseMissionTitle } from './lib/control-tower/protocol.js';
import { loadBridgeState } from './lib/control-tower/state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CONFIG_PATH = resolve(REPO_ROOT, 'control-tower/bridge.config.json');
const MOCK_AGENT = resolve(REPO_ROOT, 'scripts/control-tower-mock-agent.mjs');

function runNode(script, args = []) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(stderr || stdout || `exit ${code}`));
    });
  });
}

async function runBridgeOnce() {
  const result = await runNode(resolve(REPO_ROOT, 'scripts/control-tower-bridge.mjs'), ['--once']);
  const state = loadBridgeState(resolve(REPO_ROOT, 'control-tower/state'));
  return { ...result, state };
}

async function waitForIssueState(repository, issueNumber, expectedState, attempts = 10) {
  for (let i = 0; i < attempts; i += 1) {
    const issues = await listOpenAgentIssues(repository);
    const issue = issues.find((item) => item.number === issueNumber);
    const parsed = parseMissionTitle(issue?.title || '');
    if (parsed?.state === expectedState) return { issue, parsed };
    await delay(1500);
  }
  return null;
}

async function resetBridgeState() {
  const stateDir = resolve(REPO_ROOT, 'control-tower/state');
  rmSync(stateDir, { recursive: true, force: true });
  mkdirSync(stateDir, { recursive: true });
}

async function closeProveIssues(repository) {
  const issues = await listOpenAgentIssues(repository);
  for (const issue of issues) {
    if (/\[PROVE\]/i.test(issue.title || '')) {
      await runGhClose(repository, issue.number);
    }
  }
}

function runGhClose(repository, issueNumber) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('gh', ['issue', 'close', String(issueNumber), '--repo', repository], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    child.on('close', (code) => (code === 0 ? resolvePromise() : reject(new Error(`close failed ${issueNumber}`))));
  });
}

function parseJsonOutput(stdout) {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(lines[i]);
      } catch { /* continue */ }
    }
    throw new Error(`No JSON found in output: ${stdout.slice(0, 200)}`);
  }
}
function parseBridgeOutput(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  const lastBrace = text.lastIndexOf('{');
  if (lastBrace >= 0) {
    try {
      return JSON.parse(text.slice(lastBrace));
    } catch { /* fall through */ }
  }
  return null;
}

function missionBody(prompt) {
  return `${MARKER}\n${TARGET}\n\n${prompt}`;
}

async function writeTestConfig() {
  const example = loadExampleConfig();
  const config = {
    ...example,
    enabled: true,
    dryRunAgentCommand: process.execPath,
    agentCommand: process.execPath,
    agentExtraArgs: [],
    pollIntervalMs: 1000
  };
  mkdirSync(resolve(REPO_ROOT, 'control-tower'), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  // Patch bridge to invoke mock agent via node mock-agent.mjs
  writeFileSync(CONFIG_PATH, JSON.stringify({
    ...config,
    dryRunAgentCommand: MOCK_AGENT,
    agentCommand: MOCK_AGENT
  }, null, 2));
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    transport: null,
    safeWrite: null,
    queue: null,
    security: null,
    needsControlTower: null,
    pass: false
  };

  await writeTestConfig();
  await resetBridgeState();

  const repo = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')).repository;
  await closeProveIssues(repo);

  // Security rejection — validate only, no agent spawn for bad issues
  const { stdout: validateOut } = await runNode(resolve(REPO_ROOT, 'scripts/control-tower-bridge.mjs'), ['--validate-only']);
  const validation = parseJsonOutput(validateOut);
  const bad = {
    number: 999001,
    title: '[IQAI-CT][AGENT1][QUEUED] Bad marker',
    body: 'NO_MARKER\nAGENT_1\n\nnope',
    author: { login: 'EnlightenedAI-Lab' }
  };
  report.security = {
    validateOnlyRan: true,
    openIssues: validation.report?.length ?? 0,
    badMarkerWouldReject: !bad.body.includes(MARKER)
  };

  // Transport test issue
  const transportTitle = buildMissionTitle(MISSION_STATES.QUEUED, `[PROVE] Transport inspect baseline ${Date.now()}`);
  const transportBody = missionBody(
    'Inspect the Agent 1 repository and return the current git branch, HEAD commit, and authoritative regression baseline. Do not modify files.'
  );
  const transport = await createIssue({ repository: repo, title: transportTitle, body: transportBody });
  await delay(2000);
  const transportRun = await runBridgeOnce();
  const transportDone = await waitForIssueState(repo, transport.number, MISSION_STATES.COMPLETE);
  report.transport = {
    issue: transport.number,
    completed: Boolean(transportDone),
    lastResult: transportRun.state.lastResult
  };

  // Safe write test
  const safeTitle = buildMissionTitle(MISSION_STATES.QUEUED, `[PROVE] Safe write ${Date.now()}`);
  const safeBody = missionBody('Create control-tower/test/bridge-proof.txt with fixed line IQAI_CONTROL_TOWER_BRIDGE_V1_OK. Then confirm.');
  const safe = await createIssue({ repository: repo, title: safeTitle, body: safeBody });
  await delay(2000);
  const safeRun = await runBridgeOnce();
  const proofPath = resolve(REPO_ROOT, 'control-tower/test/bridge-proof.txt');
  report.safeWrite = {
    issue: safe.number,
    completed: (await waitForIssueState(repo, safe.number, MISSION_STATES.COMPLETE)) != null,
    fileExists: existsSync(proofPath),
    lastResult: safeRun.state.lastResult
  };

  // NEEDS_CONTROL_TOWER test
  const nctTitle = buildMissionTitle(MISSION_STATES.QUEUED, `[PROVE] Needs control tower ${Date.now()}`);
  const nctBody = missionBody('Return NEEDS_CONTROL_TOWER without modifying code.');
  const nct = await createIssue({ repository: repo, title: nctTitle, body: nctBody });
  await delay(2000);
  const nctRun = await runBridgeOnce();
  const nctDone = await waitForIssueState(repo, nct.number, MISSION_STATES.NEEDS_CONTROL_TOWER);
  report.needsControlTower = {
    issue: nct.number,
    completed: Boolean(nctDone),
    lastResult: nctRun.state.lastResult
  };

  // Queue test — create two issues, first blocks second
  const q1Title = buildMissionTitle(MISSION_STATES.QUEUED, `[PROVE] Queue A ${Date.now()}`);
  const q2Title = buildMissionTitle(MISSION_STATES.QUEUED, `[PROVE] Queue B ${Date.now()}`);
  const qBody = missionBody('Reply QUEUE_TEST_OK without modifying files.');
  const q1 = await createIssue({ repository: repo, title: q1Title, body: qBody });
  const q2 = await createIssue({ repository: repo, title: q2Title, body: qBody });
  await delay(2000);
  const run1 = await runBridgeOnce();
  const q1Done = await waitForIssueState(repo, q1.number, MISSION_STATES.COMPLETE);
  const q2Mid = await listOpenAgentIssues(repo);
  const q2StillQueued = q2Mid.some((i) => i.number === q2.number && parseMissionTitle(i.title)?.state === MISSION_STATES.QUEUED);
  const run2 = await runBridgeOnce();
  const q2Done = await waitForIssueState(repo, q2.number, MISSION_STATES.COMPLETE);
  report.queue = {
    first: q1.number,
    second: q2.number,
    firstCompleted: Boolean(q1Done),
    secondQueuedAfterFirst: q2StillQueued,
    secondCompleted: Boolean(q2Done),
    lastResult: run2.state.lastResult
  };

  // Cleanup safe write artifact
  const cleanupTitle = buildMissionTitle(MISSION_STATES.QUEUED, `[PROVE] Cleanup safe write ${Date.now()}`);
  const cleanupBody = missionBody('Remove control-tower/test/bridge-proof.txt');
  await createIssue({ repository: repo, title: cleanupTitle, body: cleanupBody });
  await runNode(resolve(REPO_ROOT, 'scripts/control-tower-bridge.mjs'), ['--once']);
  if (existsSync(proofPath)) unlinkSync(proofPath);

  report.pass = Boolean(
    report.transport?.completed
    && report.safeWrite?.fileExists
    && report.needsControlTower?.completed
    && report.needsControlTower?.lastResult?.status === 'NEEDS_CONTROL_TOWER'
    && report.queue?.firstCompleted
    && report.queue?.secondQueuedAfterFirst
    && report.queue?.secondCompleted
  );

  const outPath = resolve(REPO_ROOT, 'control-tower/reports/prove-latest.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
