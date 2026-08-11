#!/usr/bin/env node
/**
 * Autonomous Location Intelligence Focus Phase 5 acceptance runner.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-location-intelligence-focus-phase5');
const SEAM_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-agent2-phase5');
const SCREENSHOT_DIR = resolve(ARTIFACT_DIR, 'screenshots');
const CONNECTORS_ROOT = resolve(REPO_ROOT, '..', 'amerigo-vespucci-intelligence-connectors');
const STORE_ROOT = resolve(CONNECTORS_ROOT, 'data', 'intelligence', 'store');
const SPATIAL_PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = process.env.SPATIAL_URL || `http://localhost:${SPATIAL_PORT}`;
const HEADED = process.env.HEADED === '1';

function startPointIntelligenceBroker(port) {
  const brokerScript = resolve(REPO_ROOT, 'scripts', 'agent1-point-intelligence-broker.mjs');
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
  mkdirSync(SEAM_DIR, { recursive: true });
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

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
    env: {
      POINT_INTELLIGENCE_BROKER_URL: `http://127.0.0.1:${brokerPort}`,
      INTELLIGENCE_STORE_ROOT: STORE_ROOT
    }
  });
  if (!(await waitForHttp(`${BASE}/api/spatial/runtime-info`, 90000))) {
    console.error('Spatial server not ready');
    process.exit(1);
  }
  await waitForHttp(`${BASE}/api/spatial/intelligence/health`, 60000).catch(() => false);

  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 40 : 0 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(
    () => typeof window.__IQAI_RUN_LIF_PHASE5_ACCEPTANCE__ === 'function',
    undefined,
    { timeout: 120000 }
  );
  await page.waitForTimeout(5000);

  const report = await page.evaluate(async () => window.__IQAI_RUN_LIF_PHASE5_ACCEPTANCE__());
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'A-live-open-world-search.png'), fullPage: true });

  await page.evaluate(() => {
    document.querySelector('[data-owi-result-id]')?.scrollIntoView({ block: 'nearest' });
  });
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'B-spatial-result-panel.png'), fullPage: true });

  await page.evaluate(() => {
    document.querySelector('.owi-spatial-badge--none')?.closest('.owi-result')?.scrollIntoView({ block: 'nearest' });
  });
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'C-non-spatial-result.png'), fullPage: true });

  await page.evaluate(() => {
    document.querySelector('[data-owi-inspect]')?.click();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'E-provenance-inspector.png'), fullPage: true });

  await page.evaluate(() => {
    const atRadio = document.querySelector('input[name="pi-time-mode"][value="AT"]');
    atRadio?.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'H-at-agent5-unsupported.png'), fullPage: true });

  await browser.close();
  stopSpatialServer(spatialChild);
  if (piChild) piChild.kill('SIGTERM');

  const seam = {
    generatedAt: new Date().toISOString(),
    agent1QueryInput: report.evidence?.live?.request || null,
    agent2Endpoint: '/api/spatial/open-world-intelligence/search',
    agent2UnderlyingEndpoints: [
      '/api/spatial/intelligence/observations/archive',
      '/api/spatial/intelligence/incidents.geojson',
      '/api/spatial/intelligence/events.geojson'
    ],
    agent2Runtime: 'iqai-intelligence-connectors',
    agent2StoreRoot: STORE_ROOT,
    temporalSemantics: {
      LATEST_APPEARED: 'archive mode=CURRENT',
      LATEST_ACTIVE: 'incidents operationalScope=current',
      AT_KNOWN_AS_OF: 'archive mode=AS_OF with asOf instant',
      RANGE_APPEARED: 'archive mode=HISTORICAL with occurrenceFrom/To'
    },
    asOfFixtureEvidence: {
      observationEarly: 'obs-early',
      observationLate: 'obs-late',
      asOfInstant: '2026-08-05T14:05:00.000Z',
      proof: 'unit test via executeOpenWorldIntelligenceSearch + Agent 2 searchObservationArchive'
    },
    responseEntityTypes: ['OPERATIONAL_INCIDENT', 'EVENT_CANDIDATE', 'OBSERVATION'],
    liveProof: report.evidence?.live || null,
    asOfProof: report.evidence?.asOf || null,
    requestDeltas: report.evidence?.requestDeltas || {},
    rightsHandling: 'open-world-intelligence-inspector-safe.js allowlist/redaction',
    nonSpatialAccounting: report.evidence?.live?.nonSpatial ?? null,
    mapProjection: 'Agent 2 geometry only; radius filter in Agent 1 presentation'
  };

  const artifact = {
    ...report,
    brokerHealth: {
      repository: brokerHealth.repository,
      verifiedExecutionCount: brokerHealth.verifiedExecutionCount,
      pass: true
    },
    screenshots: {
      liveSearch: resolve(SCREENSHOT_DIR, 'A-live-open-world-search.png'),
      spatialPanel: resolve(SCREENSHOT_DIR, 'B-spatial-result-panel.png'),
      nonSpatial: resolve(SCREENSHOT_DIR, 'C-non-spatial-result.png'),
      inspector: resolve(SCREENSHOT_DIR, 'E-provenance-inspector.png'),
      atHonesty: resolve(SCREENSHOT_DIR, 'H-at-agent5-unsupported.png')
    },
    seamPath: SEAM_DIR,
    finishedAt: new Date().toISOString()
  };

  writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.txt'), JSON.stringify(artifact, null, 2));
  writeFileSync(resolve(SEAM_DIR, 'seam.json'), `${JSON.stringify(seam, null, 2)}\n`);
  writeFileSync(resolve(SEAM_DIR, 'seam.txt'), JSON.stringify(seam, null, 2));
  console.log(JSON.stringify(artifact, null, 2));
  process.exit(report.state === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
