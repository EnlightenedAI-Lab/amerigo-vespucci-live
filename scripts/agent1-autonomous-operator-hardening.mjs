#!/usr/bin/env node
/**
 * Autonomous Operator Hardening V1 — browser matrix + latency benchmark.
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
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-autonomous-operator-hardening');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');

const STARTUP_TIMEOUT_MS = Number(process.env.STARTUP_TIMEOUT_MS || 180000);
const RESEARCH_TIMEOUT_MS = Number(process.env.INTEL_RESEARCH_TIMEOUT_MS || 180000);
const FIRE_ITERATIONS = Number(process.env.FIRE_LATENCY_ITERATIONS || 5);

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

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function latencyStats(values) {
  const sorted = [...values].filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return { min: null, median: null, p95: null, max: null, n: 0 };
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    n: sorted.length
  };
}

loadEnvFile(resolve(REPO_ROOT, '.env'));
process.env.IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED = 'true';

const PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = process.env.SPATIAL_URL || `http://localhost:${PORT}`;
const SPATIAL_URL = `${BASE.replace(/\/$/, '')}/spatial/`;
const HEADED = process.env.HEADED === '1';

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  const portal = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  if (!username || !password) return null;
  const params = new URLSearchParams({ username, password, client: 'requestip', expiration: '60', f: 'json' });
  const res = await fetch(`${portal}/sharing/rest/generateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json().catch(() => ({}));
  return data.token ? { token: data.token, expires: data.expires } : null;
}

async function waitForRuntimeReady(page, timeoutMs = STARTUP_TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const snap = await page.evaluate(async () => {
      const shell = window.__IQAI_APP_SHELL__;
      const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__;
      let aiAvailable = false;
      try {
        const res = await fetch('/api/spatial/ai-config', { cache: 'no-store' });
        const body = await res.json();
        aiAvailable = Boolean(body?.ai?.available);
      } catch { /* ignore */ }
      return {
        canvasExists: Boolean(document.querySelector('#spatial-map-host canvas')),
        catalogLayerCount: catalog?.layers?.length || 0,
        mapOperational: shell?.mapOperational !== false,
        aiAvailable
      };
    });
    if (snap.canvasExists && snap.catalogLayerCount > 5 && snap.mapOperational && snap.aiAvailable) {
      return { ready: true, startupMs: Date.now() - started };
    }
    await page.waitForTimeout(1000);
  }
  return { ready: false, startupMs: Date.now() - started };
}

async function runPrompt(page, prompt, options = {}) {
  const input = page.locator('#spatial-ai-input');
  const runBtn = page.locator('#spatial-ai-run');
  const result = { prompt, routing: null, outcome: null, error: null, map: null, latency: {}, stateLeak: false };
  const wall = Date.now();

  await page.waitForFunction(() => {
    const btn = document.querySelector('#spatial-ai-run');
    const field = document.querySelector('#spatial-ai-input');
    return field && !field.disabled && btn && btn.textContent?.trim() !== '…';
  }, { timeout: RESEARCH_TIMEOUT_MS }).catch(() => null);

  await input.fill(prompt);
  await page.waitForTimeout(150);
  const enabled = await page.waitForFunction(() => {
    const btn = document.querySelector('#spatial-ai-run');
    return btn && !btn.disabled;
  }, { timeout: 30000 }).catch(() => null);
  if (!enabled) {
    result.error = 'AI_RUN_NOT_ENABLED';
    return result;
  }

  const submitAt = Date.now();
  const waits = [];
  if (options.waitForProgressive) {
    waits.push(page.waitForResponse(
      (res) => res.url().includes('/api/spatial/orchestrator/progressive-intelligence') && res.request().method() === 'POST',
      { timeout: RESEARCH_TIMEOUT_MS }
    ).catch((e) => ({ error: e.message })));
  }
  if (options.waitForPoi) {
    waits.push(page.waitForResponse(
      (res) => res.url().includes('/api/spatial/place-poi/search') && res.request().method() === 'POST',
      { timeout: 120000 }
    ).catch((e) => ({ error: e.message })));
  }

  await runBtn.click();
  if (waits.length) await Promise.all(waits);

  await page.waitForFunction(() => {
    const btn = document.querySelector('#spatial-ai-run');
    const field = document.querySelector('#spatial-ai-input');
    return field && !field.disabled && btn && btn.textContent?.trim() !== '…';
  }, { timeout: RESEARCH_TIMEOUT_MS }).catch(() => null);

  if (!options.quick) await page.waitForTimeout(options.settleMs ?? 8000);

  const snap = await page.evaluate(() => ({
    aiFeedback: document.querySelector('#spatial-ai-feedback')?.textContent?.trim() || '',
    aiChain: document.querySelector('#spatial-ai-chain')?.textContent?.trim() || '',
    aiPhase: document.querySelector('#spatial-ai-status-badge')?.textContent?.trim() || '',
    receipt: window.__IQAI_LAST_PROGRESSIVE_RECEIPT__ || null,
    arcgis: window.__IQAI_LAST_ARCGIS_DISCOVERY__ || null,
    poiCount: window.__IQAI_LAST_PLACE_POI_RESULT__?.places?.length ?? null,
    intelLayers: (window.__IQAI_INTELLIGENCE_LAYERS__?.length ?? 0)
  }));

  result.routing = snap.aiChain || snap.aiPhase || null;
  result.outcome = snap.aiFeedback;
  result.map = {
    arcgis: snap.arcgis,
    receipt: snap.receipt,
    poiCount: snap.poiCount,
    intelLayers: snap.intelLayers
  };
  result.latency = {
    totalInteractiveMs: Date.now() - submitAt,
    wallMs: Date.now() - wall,
    timeToFirstSourceMs: snap.receipt?.performance?.timeToFirstSourceMs ?? null,
    timeToFirstCandidateMs: snap.receipt?.performance?.timeToFirstCandidateMs ?? null,
    timeToFirstGovernedEventMs: snap.receipt?.performance?.timeToFirstGovernedEventMs ?? null,
    timeToFirstRenderedFeatureMs: snap.receipt?.performance?.clientTimeToFirstRenderedFeatureMs
      ?? snap.receipt?.performance?.timeToFirstRenderedFeatureMs ?? null
  };
  result.ok = !/failed|error|cannot read/i.test(snap.aiFeedback) && !/failed/i.test(snap.aiChain);
  if (options.expectClear) {
    result.ok = result.ok && /result cleared|map cleared/i.test(`${snap.aiFeedback} ${snap.aiChain}`);
  }
  if (options.expectPoi) result.ok = result.ok && (snap.poiCount > 0 || /starbucks|coffee|found/i.test(snap.aiFeedback));
  if (options.expectArcgis) result.ok = result.ok && Boolean(snap.arcgis?.itemId && snap.arcgis?.owner);
  if (options.noIntelLeak) {
    result.stateLeak = /intelligence|governed|fires|gemini/i.test(snap.aiChain || '');
    result.ok = result.ok && !result.stateLeak;
  }
  return result;
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    scenarios: [],
    fireLatencyIterations: [],
    pass: false
  };

  if (await isPortOpen(PORT)) killProcessOnPort(PORT);
  const serverChild = startSpatialServer(REPO_ROOT);
  if (!await waitForHttp(`${BASE}/api/spatial/runtime-info`, 90000)) process.exit(1);

  const preauth = await fetchPreauthToken();
  let browser;
  let page;
  if (preauth) {
    browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 20 : 0 });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    await page.addInitScript((tokenData) => { window.__MONTREAL_PREAUTH_TOKEN = tokenData; }, preauth);
  } else {
    browser = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
      headless: !HEADED,
      viewport: { width: 1440, height: 900 },
      slowMo: HEADED ? 20 : 0
    });
    page = browser.pages()[0] || await browser.newPage();
  }

  try {
    await page.goto(`${SPATIAL_URL}?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const startup = await waitForRuntimeReady(page);
    if (!startup.ready) {
      await page.screenshot({ path: resolve(ARTIFACT_DIR, 'startup-not-ready.png'), fullPage: true });
      process.exit(1);
    }

    const matrix = [
      { id: 'starbucks-initial', prompt: 'Map Starbucks near 997 de la Commune.', waitForPoi: true, expectPoi: true },
      { id: 'clear-1', prompt: 'clear map', expectClear: true },
      { id: 'fires-after-clear', prompt: 'Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.', waitForProgressive: true },
      { id: 'clear-2', prompt: 'clear map', expectClear: true },
      { id: 'borough', prompt: 'Find an authoritative ArcGIS layer showing Montréal borough boundaries and add it to the map.', expectArcgis: true, settleMs: 12000 },
      { id: 'bike-paths', prompt: 'Find an ArcGIS layer showing Montréal bike paths and add it to the map.', expectArcgis: true, settleMs: 12000 },
      { id: 'starbucks-final', prompt: 'Map Starbucks near 997 de la Commune.', waitForPoi: true, expectPoi: true, noIntelLeak: true }
    ];

    for (const step of matrix) {
      const shot = resolve(ARTIFACT_DIR, `${step.id}.png`);
      const outcome = await runPrompt(page, step.prompt, step);
      outcome.screenshot = shot;
      report.scenarios.push({ id: step.id, ...outcome });
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      if (!outcome.ok) {
        report.pass = false;
        writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report, null, 2));
        process.exit(1);
      }
    }

    for (let i = 0; i < FIRE_ITERATIONS; i += 1) {
      await runPrompt(page, 'clear map', { expectClear: true, quick: true, settleMs: 2000 });
      const fire = await runPrompt(page,
        'Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.',
        { waitForProgressive: true, settleMs: 5000 }
      );
      report.fireLatencyIterations.push(fire.latency);
    }

    report.fireLatencyStats = {
      timeToFirstSourceMs: latencyStats(report.fireLatencyIterations.map((l) => l.timeToFirstSourceMs)),
      timeToFirstCandidateMs: latencyStats(report.fireLatencyIterations.map((l) => l.timeToFirstCandidateMs)),
      timeToFirstGovernedEventMs: latencyStats(report.fireLatencyIterations.map((l) => l.timeToFirstGovernedEventMs)),
      timeToFirstRenderedFeatureMs: latencyStats(report.fireLatencyIterations.map((l) => l.timeToFirstRenderedFeatureMs)),
      totalInteractiveMs: latencyStats(report.fireLatencyIterations.map((l) => l.totalInteractiveMs))
    };
    report.pass = report.scenarios.every((s) => s.ok);
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
