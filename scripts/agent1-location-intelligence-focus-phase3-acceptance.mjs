#!/usr/bin/env node
/**
 * Autonomous Location Intelligence Focus Phase 3 acceptance runner.
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
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-location-intelligence-focus-phase3');
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
  await page.waitForFunction(() => typeof window.__IQAI_RUN_LIF_PHASE3_ACCEPTANCE__ === 'function', { timeout: 120000 });
  await page.waitForTimeout(5000);

  const report = await page.evaluate(async () => window.__IQAI_RUN_LIF_PHASE3_ACCEPTANCE__(true));

  await page.evaluate(async () => {
    const card = document.querySelector('[data-pi-inspect-evidence]');
    card?.click();
  });
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'A-evidence-inspector.png'), fullPage: true });

  await page.evaluate(async () => {
    const btn = document.querySelector('[data-pi-inspector-action="open-receipt"]');
    btn?.click();
  });
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'B-receipt-inspector.png'), fullPage: true });

  await page.evaluate(async () => {
    const receipts = [...document.querySelectorAll('[data-pi-inspect-receipt]')];
    if (receipts[1]) receipts[1].click();
  });
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'C-distinct-receipt.png'), fullPage: true });

  await page.evaluate(async () => {
    const noResults = [...document.querySelectorAll('[data-pi-inspect-receipt]')]
      .find((el) => el.closest('[data-coverage="NO_LOCAL_EVIDENCE"]'));
    noResults?.click();
  });
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'D-no-results-receipt.png'), fullPage: true });

  await page.evaluate(() => {
    const host = document.querySelector('#lif-inspector-host');
    if (!host) return;
    host.hidden = false;
    const issue = window.__IQAI_BUILD_PROVIDER_ISSUE_RECEIPT_FIXTURE__?.();
    if (!issue) return;
    host.innerHTML = `<div class="lif-inspector"><h4>Provider issue inspector (fixture)</h4><pre>${JSON.stringify(issue, null, 2)}</pre></div>`;
    document.querySelector('#spatial-point-intelligence-section')?.classList.add('lif-section--inspector-open');
  });
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'E-provider-issue-fixture.png'), fullPage: true });

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
    screenshots: {
      evidenceInspector: resolve(SCREENSHOT_DIR, 'A-evidence-inspector.png'),
      receiptInspector: resolve(SCREENSHOT_DIR, 'B-receipt-inspector.png'),
      distinctReceipt: resolve(SCREENSHOT_DIR, 'C-distinct-receipt.png'),
      noResultsReceipt: resolve(SCREENSHOT_DIR, 'D-no-results-receipt.png'),
      providerIssueFixture: existsSync(resolve(SCREENSHOT_DIR, 'E-provider-issue-fixture.png'))
        ? resolve(SCREENSHOT_DIR, 'E-provider-issue-fixture.png') : null
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
