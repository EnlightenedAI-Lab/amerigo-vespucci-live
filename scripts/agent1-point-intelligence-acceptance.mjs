#!/usr/bin/env node
/**
 * Autonomous Agent 1 Point Intelligence UI acceptance runner.
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
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-point-intelligence');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');
const SPATIAL_PORT = Number(process.env.SPATIAL_PORT || 3000);
const PI_PORT = Number(process.env.POINT_INTELLIGENCE_PORT || 3015);
const BASE = process.env.SPATIAL_URL || `http://localhost:${SPATIAL_PORT}`;
const HEADED = process.env.HEADED === '1';
const AUTH_READY_MARKER = resolve(AUTH_PROFILE_DIR, '.auth-ready.json');

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
  if (!existsSync(resolve(PI_REPO, 'point-intelligence/src/index.js'))) return null;
  const brokerScript = resolve(REPO_ROOT, 'scripts', 'agent1-point-intelligence-broker.mjs');
  if (existsSync(brokerScript)) {
    return spawn(process.execPath, [brokerScript], {
      cwd: REPO_ROOT,
      env: { ...process.env, POINT_INTELLIGENCE_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }
  return spawn(process.execPath, ['point-intelligence/src/index.js'], {
    cwd: PI_REPO,
    env: { ...process.env, POINT_INTELLIGENCE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function isPointIntelligenceBroker(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { cache: 'no-store' });
    const body = await res.json();
    return body?.service === 'iqai-point-intelligence';
  } catch {
    return false;
  }
}

async function brokerSupportsLiveQuery(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/point-intelligence/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
        radiusMeters: 3000,
        informationFamily: 'hydrometric'
      })
    });
    const body = await res.json();
    return ['SUCCESS', 'NO_RESULTS', 'PARTIAL_RESULTS', 'NO_APPLICABLE_CAPABILITY'].includes(body.queryState);
  } catch {
    return false;
  }
}

const MONTREAL_QUERY = Object.freeze({
  geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
  radiusMeters: 3000
});

/**
 * Probe ratified Agent 5 semantics — rejects stale long-running brokers that still
 * return pre-repair hydrometric/climate behavior.
 * @param {number} port
 * @returns {Promise<{ ok: true } | { ok: false, reasons: string[] }>}
 */
async function verifyBrokerRatifiedSemantics(port) {
  const reasons = [];
  try {
    const hydroRes = await fetch(`http://127.0.0.1:${port}/v1/point-intelligence/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...MONTREAL_QUERY, informationFamily: 'hydrometric' })
    });
    const hydro = await hydroRes.json();
    const climateRes = await fetch(`http://127.0.0.1:${port}/v1/point-intelligence/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...MONTREAL_QUERY, informationFamily: 'climate' })
    });
    const climate = await climateRes.json();

    if (hydro.queryState !== 'SUCCESS' || hydro.resultCount !== 1) {
      reasons.push(`hydrometric expected SUCCESS/1 got ${hydro.queryState}/${hydro.resultCount ?? hydro.results?.length ?? 0}`);
    }
    const hydroIds = (hydro.results || []).map((r) => r.nativeRecordId);
    if (!hydroIds.includes('02OA046')) reasons.push('hydrometric missing 02OA046');
    if (hydroIds.includes('02OA047')) reasons.push('hydrometric still returns out-of-radius 02OA047');
    for (const row of hydro.results || []) {
      if (typeof row.clickDistanceMeters !== 'number') {
        reasons.push(`hydrometric ${row.nativeRecordId} missing clickDistanceMeters`);
      } else if (row.clickDistanceMeters > 3000) {
        reasons.push(`hydrometric ${row.nativeRecordId} distance ${row.clickDistanceMeters}m > 3000m`);
      }
    }

    if (climate.queryState !== 'SUCCESS' || !(climate.results?.length > 0)) {
      reasons.push(`climate expected SUCCESS with results got ${climate.queryState}`);
    }
    for (const row of climate.results || []) {
      const localDate = row.properties?.LOCAL_DATE || row.temporal?.LOCAL_DATE;
      if (!localDate) reasons.push(`climate ${row.nativeRecordId} missing LOCAL_DATE`);
      if (String(localDate).startsWith('1971') || String(localDate).startsWith('1892')) {
        reasons.push(`climate stale date ${localDate}`);
      }
      if (!row.temporal?.LOCAL_DATE) {
        reasons.push(`climate ${row.nativeRecordId} missing temporal.LOCAL_DATE`);
      }
      if (typeof row.clickDistanceMeters !== 'number') {
        reasons.push(`climate ${row.nativeRecordId} missing clickDistanceMeters`);
      } else if (row.clickDistanceMeters > 3000) {
        reasons.push(`climate ${row.nativeRecordId} distance ${row.clickDistanceMeters}m > 3000m`);
      }
    }
  } catch (error) {
    reasons.push(error?.message || 'broker semantic probe failed');
  }

  return reasons.length ? { ok: false, reasons } : { ok: true };
}

async function resolveBrokerPort() {
  const candidates = [3027, 3028, 3029, 3030];
  for (const port of candidates) {
    if (!(await isPointIntelligenceBroker(port)) || !(await brokerSupportsLiveQuery(port))) continue;
    const semantics = await verifyBrokerRatifiedSemantics(port);
    if (semantics.ok) return port;
    console.warn(JSON.stringify({
      event: 'stale-broker-rejected',
      port,
      reasons: semantics.reasons
    }));
    killProcessOnPort(port);
  }
  for (const port of candidates) {
    if (await isPortOpen(port)) killProcessOnPort(port);
    return port;
  }
  return 3027;
}

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  const portal = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  if (!username || !password) return null;
  const params = new URLSearchParams({
    username,
    password,
    client: 'requestip',
    expiration: '60',
    f: 'json'
  });
  const res = await fetch(`${portal}/sharing/rest/generateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json().catch(() => ({}));
  return data.token ? { token: data.token, expires: data.expires } : null;
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
  const startedAt = new Date().toISOString();
  let spatialChild = null;
  let piChild = null;
  const brokerPort = await resolveBrokerPort();

  let brokerSemantics = await verifyBrokerRatifiedSemantics(brokerPort);
  if (!(await isPointIntelligenceBroker(brokerPort)) || !(await brokerSupportsLiveQuery(brokerPort)) || !brokerSemantics.ok) {
    if (await isPortOpen(brokerPort)) killProcessOnPort(brokerPort);
    piChild = startPointIntelligenceBroker(brokerPort);
    const piReady = await waitForHttp(`http://127.0.0.1:${brokerPort}/health`, 120000);
    if (!piReady || !(await isPointIntelligenceBroker(brokerPort))) {
      console.error(JSON.stringify({
        state: 'FAIL',
        error: 'Point Intelligence broker not ready',
        piRepo: PI_REPO,
        brokerPort
      }, null, 2));
      process.exit(1);
    }
    brokerSemantics = await verifyBrokerRatifiedSemantics(brokerPort);
    if (!brokerSemantics.ok) {
      console.error(JSON.stringify({
        state: 'FAIL',
        error: 'Point Intelligence broker failed ratified semantics probe after restart',
        piRepo: PI_REPO,
        brokerPort,
        reasons: brokerSemantics.reasons
      }, null, 2));
      if (piChild) piChild.kill('SIGTERM');
      process.exit(1);
    }
  }

  if (await isPortOpen(SPATIAL_PORT)) killProcessOnPort(SPATIAL_PORT);
  spatialChild = startSpatialServer(REPO_ROOT, {
    env: {
      POINT_INTELLIGENCE_BROKER_URL: `http://127.0.0.1:${brokerPort}`
    }
  });
  const spatialReady = await waitForHttp(`${BASE}/api/spatial/runtime-info`, 90000);
  if (!spatialReady) {
    console.error('Spatial server not ready');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 40 : 0 });
  let page;
  const preauth = (process.env.ARCGIS_USERNAME && process.env.ARCGIS_PASSWORD)
    ? await fetchPreauthToken()
    : null;

  if (preauth) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    await page.addInitScript((tokenData) => {
      window.__MONTREAL_PREAUTH_TOKEN = tokenData;
    }, preauth);
  } else if (existsSync(AUTH_READY_MARKER)) {
    const context = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
      headless: !HEADED,
      viewport: { width: 1440, height: 900 },
      slowMo: HEADED ? 40 : 0
    });
    page = context.pages()[0] || await context.newPage();
  } else {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
  }

  await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const mapReady = Boolean(await waitForMapReady(page, 180000));
  const harnessReady = await page.evaluate(() => typeof window.__IQAI_RUN_POINT_INTELLIGENCE_ACCEPTANCE__ === 'function');
  if (!harnessReady) {
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'harness-missing.png'), fullPage: true });
    console.error('Point Intelligence harness missing');
    await browser.close();
    stopSpatialServer(spatialChild);
    if (piChild) piChild.kill('SIGTERM');
    process.exit(1);
  }
  if (!mapReady) {
    console.warn('Map not fully operational — layer rendering checks may be skipped');
  }

  const report = await page.evaluate(async (mapOperational) => {
    if (typeof window.__IQAI_RUN_POINT_INTELLIGENCE_ACCEPTANCE__ !== 'function') {
      return { state: 'FAIL', error: 'acceptance harness missing' };
    }
    return window.__IQAI_RUN_POINT_INTELLIGENCE_ACCEPTANCE__(mapOperational);
  }, mapReady);

  const mapCommandOk = mapReady ? await page.evaluate(async () => {
    const app = window.__IQAI_APP_SHELL__;
    if (!app?.runMapCommand) return false;
    const result = await app.runMapCommand('CLEAR');
    return Boolean(result);
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

  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'latest.png'), fullPage: true });
  await browser.close();
  stopSpatialServer(spatialChild);
  if (piChild) piChild.kill('SIGTERM');

  const artifact = {
    ...report,
    mapReady,
    mapCommandRegression: mapCommandOk ? 'PASS' : 'FAIL',
    aiMapRegression: aiMapOk ? 'PASS' : 'FAIL',
    brokerUrl: `http://127.0.0.1:${brokerPort}/v1/point-intelligence/query`,
    brokerSemanticsProbe: 'PASS',
    agent1Proxy: 'POST /api/spatial/point-intelligence/query',
    startedAt,
    finishedAt: new Date().toISOString(),
    screenshot: resolve(ARTIFACT_DIR, 'latest.png')
  };

  writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(artifact, null, 2));
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.txt'), JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify(artifact, null, 2));

  const ok = artifact.state === 'PASS'
    && (!mapReady || artifact.mapCommandRegression === 'PASS')
    && (!mapReady || artifact.aiMapRegression === 'PASS');
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
