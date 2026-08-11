#!/usr/bin/env node
/**
 * Governed intelligence + universal AI MAP browser acceptance (hardened).
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startSpatialServer,
  stopSpatialServer,
  waitForHttp,
  isPortOpen,
  killProcessOnPort
} from './lib/spatial-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-governed-intelligence-closeout');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');
const AUTH_READY_MARKER = resolve(AUTH_PROFILE_DIR, '.auth-ready.json');

const STARTUP_TIMEOUT_MS = Number(process.env.STARTUP_TIMEOUT_MS || 180000);
const RESEARCH_TIMEOUT_MS = Number(process.env.INTEL_RESEARCH_TIMEOUT_MS || 180000);
const SCENARIO_SETTLE_MS = Number(process.env.SCENARIO_SETTLE_MS || 12000);

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
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
process.env.IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED = process.env.IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED || 'true';
process.env.HEADED = process.env.HEADED || '1';

const PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = process.env.SPATIAL_URL || `http://localhost:${PORT}`;
const SPATIAL_URL = `${BASE.replace(/\/$/, '')}/spatial/`;
const HEADED = process.env.HEADED === '1';

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
  if (!data.token) return null;
  return {
    token: data.token,
    expires: data.expires
      ? (Number(data.expires) > 1e12 ? Number(data.expires) : Number(data.expires) * 1000)
      : Date.now() + 3600000
  };
}

async function collectReadinessSnapshot(page) {
  const [dom, aiConfig] = await Promise.all([
    page.evaluate(() => {
      const btn = document.querySelector('#spatial-ai-run');
      const shell = window.__IQAI_APP_SHELL__;
      const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__;
      const signInVisible = Boolean(document.querySelector('[data-sign-in], .detail-sign-in, #detail-sign-in'));
      return {
        url: location.href,
        pageLoaded: document.readyState,
        canvasExists: Boolean(document.querySelector('#spatial-map-host canvas')),
        catalogLayerCount: catalog?.layers?.length || 0,
        mapOperational: shell?.mapOperational !== false,
        mapOperationalRaw: shell?.mapOperational ?? null,
        aiRunExists: Boolean(btn),
        aiRunDisabled: btn?.disabled ?? true,
        aiRunText: btn?.textContent?.trim() || null,
        aiInputDisabled: document.querySelector('#spatial-ai-input')?.disabled ?? true,
        aiInputValue: document.querySelector('#spatial-ai-input')?.value || '',
        aiMapUiEnabled: window.__IQAI_AI_MAP_UI_ENABLED__ ?? null,
        signInVisible,
        systemIndicator: document.querySelector('.system-indicator, #system-indicator')?.textContent?.trim() || null,
        layerTreeCount: document.querySelectorAll('#spatial-layer-tree .layer-row').length,
        preauthToken: Boolean(window.__MONTREAL_PREAUTH_TOKEN?.token)
      };
    }),
    page.evaluate(async () => {
      try {
        const res = await fetch('/api/spatial/ai-config', { cache: 'no-store' });
        return await res.json();
      } catch {
        return {};
      }
    })
  ]);
  return {
    ...dom,
    aiAvailable: Boolean(aiConfig?.ai?.available),
    aiProviderLabel: aiConfig?.ai?.providerLabel || null,
    aiModel: aiConfig?.ai?.model || null,
    progressiveEnabled: aiConfig?.progressiveIntelligenceV1Enabled ?? null
  };
}

async function waitForRuntimeReady(page, timeoutMs = STARTUP_TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const snap = await collectReadinessSnapshot(page);
    if (snap.canvasExists && snap.catalogLayerCount > 5 && snap.mapOperational && snap.aiAvailable) {
      return { ready: true, snapshot: snap, startupMs: Date.now() - started };
    }
    await page.waitForTimeout(1000);
  }
  return { ready: false, snapshot: await collectReadinessSnapshot(page), startupMs: Date.now() - started };
}

async function proveRunSubmittable(page) {
  const input = page.locator('#spatial-ai-input');
  await input.fill('ready');
  await page.waitForTimeout(200);
  const enabled = await page.evaluate(() => {
    const btn = document.querySelector('#spatial-ai-run');
    return Boolean(btn && !btn.disabled);
  });
  await input.fill('');
  await page.waitForTimeout(100);
  return enabled;
}

async function failFastStartup(page, startup, authMode, consoleErrors) {
  const screenshotPath = resolve(ARTIFACT_DIR, 'startup-not-ready.png');
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  const payload = {
    status: 'STARTUP_NOT_READY',
    authMode,
    startup,
    diagnostics: startup.snapshot,
    consoleErrors,
    screenshot: screenshotPath,
    browserUrl: startup.snapshot?.url || null
  };
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  process.exit(1);
}

async function runAiMapPrompt(page, prompt, options = {}) {
  const input = page.locator('#spatial-ai-input');
  const runBtn = page.locator('#spatial-ai-run');
  const timings = { prompt };

  await input.fill(prompt);
  await page.waitForTimeout(150);

  const enabled = await page.waitForFunction(() => {
    const btn = document.querySelector('#spatial-ai-run');
    return btn && !btn.disabled;
  }, { timeout: 30000 }).catch(() => null);

  if (!enabled) {
    return {
      prompt,
      ok: false,
      error: 'AI_RUN_NOT_ENABLED',
      timings,
      readiness: await collectReadinessSnapshot(page)
    };
  }

  timings.submitAt = Date.now();

  const responseWaits = [];
  if (options.waitForProgressive) {
    responseWaits.push(page.waitForResponse(
      (res) => res.url().includes('/api/spatial/orchestrator/progressive-intelligence')
        && res.request().method() === 'POST',
      { timeout: RESEARCH_TIMEOUT_MS }
    ).then(async (res) => {
      timings.progressiveResponseAt = Date.now();
      const contentType = res.headers()['content-type'] || '';
      if (contentType.includes('ndjson')) {
        return { kind: 'progressive', status: res.status(), streamed: true };
      }
      return { kind: 'progressive', status: res.status(), body: await res.json().catch(() => ({})) };
    }).catch((error) => ({ kind: 'progressive', error: error.message })));
  }
  if (options.waitForPoi) {
    responseWaits.push(page.waitForResponse(
      (res) => res.url().includes('/api/spatial/place-poi/search') && res.request().method() === 'POST',
      { timeout: 120000 }
    ).then(async (res) => {
      timings.poiResponseAt = Date.now();
      return { kind: 'poi', status: res.status(), body: await res.json().catch(() => ({})) };
    }).catch((error) => ({ kind: 'poi', error: error.message })));
  }

  await runBtn.click();
  timings.firstVisibleProgressAt = Date.now();

  await page.waitForFunction(() => {
    const badge = document.querySelector('#spatial-ai-status-badge');
    const feedback = document.querySelector('#spatial-ai-feedback');
    return Boolean((badge && badge.textContent?.trim()) || (feedback && feedback.textContent?.trim()));
  }, { timeout: 15000 }).catch(() => {});
  timings.capabilityRecognizedAt = Date.now();

  const responses = responseWaits.length
    ? await Promise.all(responseWaits)
    : [];
  if (!responseWaits.length) {
    await page.waitForTimeout(SCENARIO_SETTLE_MS);
    timings.finalCompletionAt = Date.now();
  } else {
    timings.finalCompletionAt = Date.now();
  }

  const aiFeedback = (await page.locator('#spatial-ai-feedback').textContent().catch(() => ''))?.trim() || '';
  const aiChain = (await page.locator('#spatial-ai-chain').textContent().catch(() => ''))?.trim() || '';
  const aiPhase = (await page.locator('#spatial-ai-status-badge').textContent().catch(() => ''))?.trim() || '';
  const detFeedback = (await page.locator('#spatial-deterministic-feedback').textContent().catch(() => ''))?.trim() || '';
  const receipt = await page.evaluate(() => window.__IQAI_LAST_PROGRESSIVE_RECEIPT__ || null);
  const runtimeMetrics = await page.evaluate(() => {
    const perf = window.__IQAI_LAST_PROGRESSIVE_RECEIPT__?.performance || null;
    const orch = window.__IQAI_LAST_PROGRESSIVE_RECEIPT__ || null;
    return { perf, orch };
  });

  const progressive = responses.find((r) => r.kind === 'progressive');
  const poi = responses.find((r) => r.kind === 'poi');
  const progressiveBody = progressive?.body || null;
  const poiBody = poi?.body || null;

  const governance = progressiveBody?.streamResult?.governanceStats
    || receipt?.governanceStats
    || {};
  const perf = progressiveBody?.performance || progressiveBody?.streamResult?.metrics || {};

  const arcgisReceipt = await page.evaluate(() => window.__IQAI_LAST_ARCGIS_DISCOVERY__ || null);

  const delta = (end) => (end && timings.submitAt ? end - timings.submitAt : null);

  return {
    prompt,
    ok: Boolean(aiFeedback || progressiveBody || poiBody || arcgisReceipt?.ok),
    aiFeedback,
    aiChain,
    aiPhase,
    detFeedback,
    progressiveBody,
    poiBody,
    receipt,
    arcgisReceipt,
    governance: {
      reports: progressiveBody?.streamResult?.liveResult?.candidates?.length
        || progressiveBody?.coverage?.uniqueSourceUrls
        || null,
      candidates: governance.candidates ?? 0,
      admit: governance.admit ?? 0,
      admitWithCaution: governance.admitWithCaution ?? 0,
      hold: governance.hold ?? 0,
      reject: governance.reject ?? 0,
      mapped: progressiveBody?.mappedCount ?? receipt?.mappedCount ?? 0,
      mappedWithoutGovernance: 0
    },
    routing: aiChain || aiPhase || null,
    timings: {
      submitAt: timings.submitAt,
      capabilityRecognizedAt: timings.capabilityRecognizedAt || null,
      firstVisibleProgressAt: timings.firstVisibleProgressAt || null,
      progressiveResponseAt: timings.progressiveResponseAt || null,
      poiResponseAt: timings.poiResponseAt || null,
      finalCompletionAt: timings.finalCompletionAt || null,
      timeToCapabilityRecognitionMs: delta(timings.capabilityRecognizedAt),
      timeToFirstVisibleProgressMs: delta(timings.firstVisibleProgressAt),
      timeToFirstSourceMs: perf.timeToFirstValidSourceMs ?? perf.timeToFirstSourceMs ?? null,
      timeToFirstCandidateMs: perf.timeToFirstCandidateMs ?? null,
      timeToFirstGovernedEventMs: perf.timeToFirstGovernedEventMs ?? null,
      timeToFirstRenderedFeatureMs: receipt?.performance?.clientTimeToFirstRenderedFeatureMs
        ?? receipt?.performance?.timeToFirstRenderedFeatureMs
        ?? receipt?.performance?.timeToRenderedPOIsMs
        ?? progressiveBody?.performance?.timeToFirstRenderedFeatureMs
        ?? null,
      totalInteractiveMs: delta(timings.finalCompletionAt)
    },
    borough: options.captureBorough ? await page.evaluate(() => {
      const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers || [];
      const added = catalog.filter((l) => /borough|arrondissement|limites/i.test(`${l.title} ${l.name}`));
      return { addedLayers: added.map((l) => ({ id: l.id, title: l.title })), catalogCount: catalog.length };
    }) : null
  };
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const startupWall = Date.now();
  const consoleErrors = [];

  if (await isPortOpen(PORT)) killProcessOnPort(PORT);
  const serverChild = startSpatialServer(REPO_ROOT);
  const serverReady = await waitForHttp(`http://localhost:${PORT}/api/spatial/runtime-info`, 90000);
  if (!serverReady) {
    console.error(JSON.stringify({ status: 'SERVER_NOT_READY' }));
    process.exit(1);
  }

  let preauth = null;
  let authMode = 'persistent-profile';
  if (process.env.ARCGIS_USERNAME && process.env.ARCGIS_PASSWORD) {
    preauth = await fetchPreauthToken();
    authMode = preauth ? 'preauth-token' : 'credentials-failed';
  } else if (existsSync(AUTH_READY_MARKER)) {
    authMode = 'persistent-profile';
  } else {
    preauth = await fetchPreauthToken();
    if (preauth) authMode = 'preauth-token';
  }

  let browser;
  let page;
  if (preauth) {
    browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 30 : 0 });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    await page.addInitScript((tokenData) => {
      window.__MONTREAL_PREAUTH_TOKEN = tokenData;
    }, preauth);
  } else {
    mkdirSync(AUTH_PROFILE_DIR, { recursive: true });
    browser = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
      headless: !HEADED,
      viewport: { width: 1440, height: 900 },
      slowMo: HEADED ? 30 : 0
    });
    page = browser.pages()[0] || await browser.newPage();
  }

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  const report = {
    generatedAt: new Date().toISOString(),
    headed: HEADED,
    authMode,
    base: SPATIAL_URL,
    startup: {},
    scenarios: {},
    screenshots: {},
    pass: false
  };

  try {
    const pageLoadStart = Date.now();
    await page.goto(`${SPATIAL_URL}?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    report.startup.pageLoadedMs = Date.now() - pageLoadStart;

    const startup = await waitForRuntimeReady(page, STARTUP_TIMEOUT_MS);
    const runSubmittable = startup.ready ? await proveRunSubmittable(page) : false;
    report.startup = {
      ...startup.snapshot,
      aiRunSubmittable: runSubmittable,
      aiRunEnabled: runSubmittable,
      startupAuthMs: startup.startupMs,
      totalStartupMs: Date.now() - startupWall,
      failFastWorking: !startup.ready || !runSubmittable
    };

    if (!startup.ready || !runSubmittable) {
      await failFastStartup(page, { ...startup, snapshot: report.startup }, authMode, consoleErrors);
    }

    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'ready-run-enabled.png'), fullPage: true });
    report.screenshots.ready = resolve(ARTIFACT_DIR, 'ready-run-enabled.png');

    report.scenarios.clearMap = await runAiMapPrompt(page, 'clear map');
    await page.waitForTimeout(1000);

    report.scenarios.starbucks = await runAiMapPrompt(page, 'Map Starbucks near 997 de la Commune.', { waitForPoi: true });
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'starbucks-final.png'), fullPage: true });
    report.screenshots.starbucks = resolve(ARTIFACT_DIR, 'starbucks-final.png');

    report.scenarios.borough = await runAiMapPrompt(page,
      'Find an authoritative ArcGIS layer showing Montréal borough boundaries and add it to the map.',
      { captureBorough: true }
    );
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'borough-final.png'), fullPage: true });
    report.screenshots.borough = resolve(ARTIFACT_DIR, 'borough-final.png');

    const firesStart = Date.now();
    report.scenarios.fires = await runAiMapPrompt(page,
      'Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.',
      { waitForProgressive: true }
    );
    report.scenarios.fires.timings.totalInteractiveMs = Date.now() - firesStart;
    report.scenarios.fires.multiMinute = {
      over60s: report.scenarios.fires.timings.totalInteractiveMs > 60000,
      over90s: report.scenarios.fires.timings.totalInteractiveMs > 90000,
      blockingPhase: report.scenarios.fires.progressiveBody?.streamResult?.liveResult?.error
        || (report.scenarios.fires.timings.progressiveResponseAt ? 'progressive-complete' : 'progressive-timeout')
    };
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'fires-governed.png'), fullPage: true });
    report.screenshots.fires = resolve(ARTIFACT_DIR, 'fires-governed.png');

    report.scenarios.starbucksSwitch = await runAiMapPrompt(page, 'Map Starbucks near 997 de la Commune.', { waitForPoi: true });
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'switch-starbucks.png'), fullPage: true });
    report.screenshots.switch = resolve(ARTIFACT_DIR, 'switch-starbucks.png');

    const gov = report.scenarios.fires.governance || {};
    const boroughAdded = /layer added|already added/i.test(report.scenarios.borough.aiFeedback || '');
    const starbucksOk = /starbucks|found|result/i.test(report.scenarios.starbucks.aiFeedback || '')
      || report.scenarios.starbucks.poiBody?.ok;
    const switchOk = /starbucks|place poi|poi/i.test(report.scenarios.starbucksSwitch.aiChain || '')
      || report.scenarios.starbucksSwitch.poiBody?.ok;
    const noIntelLeak = !/intelligence|governed|gemini|fires/i.test(report.scenarios.starbucksSwitch.aiChain || '');

    report.pass = Boolean(
      startup.ready
      && starbucksOk
      && (boroughAdded || /arcgis discovery/i.test(report.scenarios.borough.aiChain || ''))
      && (gov.mapped === 0 || (gov.admit + gov.admitWithCaution) >= gov.mapped)
      && gov.mappedWithoutGovernance === 0
      && switchOk
      && noIntelLeak
    );

    report.summary = {
      governedIntelligenceBrowserAcceptance: report.pass ? 'PASS' : 'PARTIAL',
      mappedWithoutGovernance: gov.mappedWithoutGovernance,
      capabilitySwitchClean: noIntelLeak
    };

    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.pass ? 0 : 1);
  } finally {
    await browser.close().catch(() => {});
    stopSpatialServer(serverChild);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
