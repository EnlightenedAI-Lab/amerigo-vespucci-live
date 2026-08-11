#!/usr/bin/env node
/**
 * Autonomous Location Intelligence Focus Phase 2 acceptance runner.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
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
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-location-intelligence-focus-phase2');
const SCREENSHOT_DIR = resolve(ARTIFACT_DIR, 'screenshots');
const SPATIAL_PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = process.env.SPATIAL_URL || `http://localhost:${SPATIAL_PORT}`;
const HEADED = process.env.HEADED === '1';

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

  await page.waitForFunction(() => typeof window.__IQAI_RUN_LIF_PHASE2_ACCEPTANCE__ === 'function', { timeout: 120000 });
  await page.waitForTimeout(5000);

  const report = await page.evaluate(async () => window.__IQAI_RUN_LIF_PHASE2_ACCEPTANCE__(true));
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'A-representative-montreal.png'), fullPage: true });

  await page.evaluate(async () => {
    const panel = document.querySelector('#spatial-point-intelligence-results');
    const family = panel?.querySelector('.lif-family[data-coverage="EVIDENCE"]');
    family?.querySelector('.lif-family__summary')?.click();
  });
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'B-focused-family.png'), fullPage: true });

  await page.evaluate(async () => {
    const card = document.querySelector('#spatial-point-intelligence-results [data-pi-observation-id]');
    card?.click();
  });
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'C-focused-observation.png'), fullPage: true });

  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'D-panel-focused-observation.png'), fullPage: true });

  const thinningVisible = await page.evaluate(() => {
    const el = document.querySelector('[data-pi-map-accounting]');
    return el && !el.hidden && el.textContent?.includes('map locations');
  });
  if (thinningVisible) {
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'E-thinning-indicator.png'), fullPage: true });
  }

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
    presentationAccounting: report.presentationModel?.accounting || null,
    screenshots: {
      representative: resolve(SCREENSHOT_DIR, 'A-representative-montreal.png'),
      focusedFamily: resolve(SCREENSHOT_DIR, 'B-focused-family.png'),
      focusedObservation: resolve(SCREENSHOT_DIR, 'C-focused-observation.png'),
      panelFocused: resolve(SCREENSHOT_DIR, 'D-panel-focused-observation.png'),
      thinning: existsSync(resolve(SCREENSHOT_DIR, 'E-thinning-indicator.png'))
        ? resolve(SCREENSHOT_DIR, 'E-thinning-indicator.png') : null
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
