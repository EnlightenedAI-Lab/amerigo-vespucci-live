#!/usr/bin/env node
/**
 * Autonomous Location Intelligence Focus Phase 1 acceptance runner.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  startSpatialServer,
  stopSpatialServer,
  waitForHttp,
  isPortOpen,
  killProcessOnPort
} from './lib/spatial-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PI_REPO = resolve(REPO_ROOT, '..', 'amerigo-vespucci-point-intelligence');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-location-intelligence-focus-phase1');
const SCREENSHOT_DIR = resolve(ARTIFACT_DIR, 'screenshots');
const SPATIAL_PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = process.env.SPATIAL_URL || `http://localhost:${SPATIAL_PORT}`;
const HEADED = process.env.HEADED === '1';
const V3_BEFORE = resolve(REPO_ROOT, 'artifacts', 'agent1-point-intelligence-v3', 'screenshots', 'montreal-bundle.png');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(resolve(REPO_ROOT, '.env'));
loadEnvFile(resolve(PI_REPO, '.env'));

function startPointIntelligenceBroker(port) {
  const brokerScript = resolve(REPO_ROOT, 'scripts', 'agent1-point-intelligence-broker.mjs');
  if (!existsSync(brokerScript)) return null;
  return spawn(process.execPath, [brokerScript], {
    cwd: REPO_ROOT,
    env: { ...process.env, POINT_INTELLIGENCE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function fetchBrokerHealth(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { cache: 'no-store' });
    return await res.json();
  } catch {
    return null;
  }
}

async function isPointIntelligenceBroker(port) {
  const body = await fetchBrokerHealth(port);
  return body?.service === 'iqai-point-intelligence';
}

async function resolveBrokerPort() {
  for (const port of [3027, 3028, 3029, 3030]) {
    if (await isPointIntelligenceBroker(port)) return port;
    if (await isPortOpen(port)) killProcessOnPort(port);
  }
  return 3027;
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  if (existsSync(V3_BEFORE)) {
    copyFileSync(V3_BEFORE, resolve(SCREENSHOT_DIR, 'before-v3-scroll-wall.png'));
  }

  let spatialChild = null;
  let piChild = null;
  const brokerPort = await resolveBrokerPort();
  let brokerHealth = await fetchBrokerHealth(brokerPort);

  if (!brokerHealth || brokerHealth.repository !== 'postgresql' || brokerHealth.verifiedExecutionCount < 7) {
    if (await isPortOpen(brokerPort)) killProcessOnPort(brokerPort);
    piChild = startPointIntelligenceBroker(brokerPort);
    await waitForHttp(`http://127.0.0.1:${brokerPort}/health`, 120000);
    brokerHealth = await fetchBrokerHealth(brokerPort);
    if (!brokerHealth || brokerHealth.repository !== 'postgresql' || brokerHealth.verifiedExecutionCount < 7) {
      console.error(JSON.stringify({ state: 'FAIL', error: 'Broker health gate failed', brokerHealth }, null, 2));
      process.exit(1);
    }
  }

  if (await isPortOpen(SPATIAL_PORT)) killProcessOnPort(SPATIAL_PORT);
  spatialChild = startSpatialServer(REPO_ROOT, {
    env: { POINT_INTELLIGENCE_BROKER_URL: `http://127.0.0.1:${brokerPort}` }
  });
  if (!(await waitForHttp(`${BASE}/api/spatial/runtime-info`, 90000))) {
    console.error('Spatial server not ready');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 40 : 0 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });

  const harnessReady = await page.evaluate(() => (
    typeof window.__IQAI_RUN_LIF_PHASE1_ACCEPTANCE__ === 'function'
  ));
  if (!harnessReady) {
    console.error('LIF Phase 1 harness missing');
    process.exit(1);
  }

  const report = await page.evaluate(async () => window.__IQAI_RUN_LIF_PHASE1_ACCEPTANCE__(false));
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'after-lif-phase1.png'), fullPage: true });

  const panelShot = await page.locator('#spatial-point-intelligence-results').screenshot({
    path: resolve(SCREENSHOT_DIR, 'after-lif-panel.png')
  }).catch(() => null);

  await browser.close();
  stopSpatialServer(spatialChild);
  if (piChild) piChild.kill('SIGTERM');

  const artifact = {
    ...report,
    brokerHealth: {
      repository: brokerHealth.repository,
      verifiedExecutionCount: brokerHealth.verifiedExecutionCount,
      pass: true
    },
    lifSummary: report.montreal?.lifModel?.summary || null,
    temporalMix: report.montreal?.lifModel?.summary?.temporalMix || null,
    coverageDomains: (report.montreal?.lifModel?.coverage?.domains || []).map((d) => ({
      id: d.id,
      label: d.label,
      evidenceCount: d.evidenceCount,
      familyCount: d.familyCount,
      families: d.families.map((f) => ({
        family: f.informationFamily,
        label: f.label,
        coverageState: f.coverageState,
        resultCount: f.resultCount
      }))
    })),
    relationshipFacts: report.montreal?.lifModel?.facts || [],
    screenshots: {
      before: existsSync(resolve(SCREENSHOT_DIR, 'before-v3-scroll-wall.png'))
        ? resolve(SCREENSHOT_DIR, 'before-v3-scroll-wall.png') : null,
      after: resolve(SCREENSHOT_DIR, 'after-lif-phase1.png'),
      panel: resolve(SCREENSHOT_DIR, 'after-lif-panel.png')
    },
    finishedAt: new Date().toISOString()
  };

  writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.txt'), JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify(artifact, null, 2));
  process.exit(report.state === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
