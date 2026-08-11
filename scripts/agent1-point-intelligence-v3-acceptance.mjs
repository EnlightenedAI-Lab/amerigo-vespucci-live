#!/usr/bin/env node
/**
 * Autonomous Agent 1 Point Intelligence V3 unified bundle acceptance runner.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-point-intelligence-v3');
const SCREENSHOT_DIR = resolve(ARTIFACT_DIR, 'screenshots');
const SPATIAL_PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = process.env.SPATIAL_URL || `http://localhost:${SPATIAL_PORT}`;
const HEADED = process.env.HEADED === '1';

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

async function brokerSupportsBundle(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/point-intelligence/query-bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
        radiusMeters: 3000,
        informationFamilies: 'AUTO',
        temporalIntent: { mode: 'LATEST' }
      })
    });
    const body = await res.json();
    return body?.bundleState != null || Array.isArray(body?.families);
  } catch {
    return false;
  }
}

async function resolveBrokerPort() {
  const candidates = [3027, 3028, 3029, 3030];
  for (const port of candidates) {
    if (!(await isPointIntelligenceBroker(port))) continue;
    if (await brokerSupportsBundle(port)) return port;
    killProcessOnPort(port);
  }
  for (const port of candidates) {
    if (await isPortOpen(port)) killProcessOnPort(port);
    return port;
  }
  return 3027;
}

async function waitForMapReady(page, timeoutMs = 180000) {
  return page.waitForFunction(() => {
    const canvas = document.querySelector('#spatial-map-host canvas');
    const layers = document.querySelectorAll('#spatial-layer-tree .layer-row input[type="checkbox"]');
    const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers?.length || 0;
    const operational = window.__IQAI_APP_SHELL__?.mapOperational !== false;
    return Boolean(canvas && layers.length > 0 && catalog > 5 && operational);
  }, { timeout: timeoutMs }).catch(() => false);
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  let spatialChild = null;
  let piChild = null;
  let brokerPort = await resolveBrokerPort();

  let brokerHealth = await fetchBrokerHealth(brokerPort);
  if (!brokerHealth || brokerHealth.repository !== 'postgresql' || brokerHealth.verifiedExecutionCount < 7) {
    if (await isPortOpen(brokerPort)) killProcessOnPort(brokerPort);
    piChild = startPointIntelligenceBroker(brokerPort);
    const piReady = await waitForHttp(`http://127.0.0.1:${brokerPort}/health`, 120000);
    brokerHealth = await fetchBrokerHealth(brokerPort);
    if (!piReady || !brokerHealth || brokerHealth.repository !== 'postgresql' || brokerHealth.verifiedExecutionCount < 7) {
      const blocker = {
        state: 'FAIL',
        error: 'Agent 5 broker health gate failed',
        brokerHealth,
        brokerPort
      };
      writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(blocker, null, 2)}\n`);
      console.error(JSON.stringify(blocker, null, 2));
      process.exit(1);
    }
  }

  if (!(await brokerSupportsBundle(brokerPort))) {
    const blocker = {
      state: 'FAIL',
      error: 'Agent 5 bundle endpoint unavailable',
      brokerPort
    };
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(blocker, null, 2)}\n`);
    console.error(JSON.stringify(blocker, null, 2));
    process.exit(1);
  }

  if (await isPortOpen(SPATIAL_PORT)) killProcessOnPort(SPATIAL_PORT);
  spatialChild = startSpatialServer(REPO_ROOT, {
    env: { POINT_INTELLIGENCE_BROKER_URL: `http://127.0.0.1:${brokerPort}` }
  });
  const spatialReady = await waitForHttp(`${BASE}/api/spatial/runtime-info`, 90000);
  if (!spatialReady) {
    console.error('Spatial server not ready');
    process.exit(1);
  }

  const bundleProxyCheck = await fetch(`${BASE}/api/spatial/point-intelligence/query-bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
      radiusMeters: 3000,
      informationFamilies: 'AUTO',
      temporalIntent: { mode: 'LATEST' }
    })
  });
  const bundleProxyBody = await bundleProxyCheck.json();

  const maliciousBundle = await fetch(`${BASE}/api/spatial/point-intelligence/query-bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
      url: 'https://evil.example',
      capabilityId: 'evil'
    })
  });
  const maliciousBody = await maliciousBundle.json();

  const singleFamilyProxy = await fetch(`${BASE}/api/spatial/point-intelligence/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
      radiusMeters: 3000,
      informationFamily: 'weather'
    })
  });
  const singleFamilyBody = await singleFamilyProxy.json();

  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 40 : 0 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const mapReady = Boolean(await waitForMapReady(page, 180000));

  const harnessReady = await page.evaluate(() => (
    typeof window.__IQAI_RUN_POINT_INTELLIGENCE_V3_ACCEPTANCE__ === 'function'
  ));
  if (!harnessReady) {
    console.error('V3 harness missing');
    process.exit(1);
  }

  const report = await page.evaluate(async (operational) => (
    window.__IQAI_RUN_POINT_INTELLIGENCE_V3_ACCEPTANCE__(operational)
  ), mapReady);

  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'montreal-bundle.png'), fullPage: true });

  const mapCommandOk = mapReady ? await page.evaluate(async () => {
    const app = window.__IQAI_APP_SHELL__;
    if (!app?.runMapCommand) return false;
    return Boolean(await app.runMapCommand('CLEAR'));
  }) : false;

  const aiMapOk = mapReady ? await page.evaluate(async () => {
    const originalFetch = window.fetch;
    window.fetch = async (url, init) => {
      if (String(url).includes('/api/spatial/ai-map')) {
        return new Response(JSON.stringify({
          supported: false,
          status: 'NEEDS_CLARIFICATION',
          message: 'Which type of station do you mean — police, fire, or transit?'
        }), { status: 422, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(url, init);
    };
    try {
      const app = window.__IQAI_APP_SHELL__;
      const result = await app.runAiMapCommand('Show me the nearest stations.');
      return result?.status === 'NEEDS_CLARIFICATION';
    } finally {
      window.fetch = originalFetch;
    }
  }) : false;

  await browser.close();
  stopSpatialServer(spatialChild);
  if (piChild) piChild.kill('SIGTERM');

  const artifact = {
    ...report,
    brokerHealth: {
      repository: brokerHealth.repository,
      verifiedExecutionCount: brokerHealth.verifiedExecutionCount,
      pass: brokerHealth.repository === 'postgresql' && brokerHealth.verifiedExecutionCount >= 7
    },
    mapReady,
    mapCommandRegression: mapCommandOk ? 'PASS' : 'FAIL',
    aiMapRegression: aiMapOk ? 'PASS' : 'FAIL',
    networkProxyPath: 'browser → POST /api/spatial/point-intelligence/query-bundle → Agent 5 broker /v1/point-intelligence/query-bundle',
    bundleProxyCheck: {
      status: bundleProxyCheck.status,
      bundleState: bundleProxyBody?.bundleState || null,
      bundleId: bundleProxyBody?.bundleId || bundleProxyBody?.orchestrationId || null,
      familyCount: bundleProxyBody?.families?.length ?? null,
      plannerDecision: bundleProxyBody?.plannerDecision || null
    },
    securityChecks: {
      maliciousRejected: maliciousBundle.status === 400 || maliciousBody?.bundleState === 'INVALID_REQUEST',
      singleFamilyV2: {
        status: singleFamilyProxy.status,
        queryState: singleFamilyBody?.queryState || null
      }
    },
    brokerUrl: `http://127.0.0.1:${brokerPort}/v1/point-intelligence/query-bundle`,
    startedAt,
    finishedAt: new Date().toISOString(),
    screenshot: resolve(SCREENSHOT_DIR, 'montreal-bundle.png')
  };

  writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.txt'), JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify(artifact, null, 2));

  const ok = artifact.state === 'PASS'
    && artifact.brokerHealth.pass
    && artifact.bundleProxyCheck.bundleState
    && artifact.securityChecks.maliciousRejected
    && artifact.securityChecks.singleFamilyV2.queryState
    && artifact.modeOff?.pass
    && (!mapReady || artifact.mapCommandRegression === 'PASS')
    && (!mapReady || artifact.aiMapRegression === 'PASS');
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
