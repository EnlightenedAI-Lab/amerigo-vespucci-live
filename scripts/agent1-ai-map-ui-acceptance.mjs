#!/usr/bin/env node
/**
 * Autonomous Agent 1 AI MAP UI acceptance runner.
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
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-ai-map-ui');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');
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

const PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = process.env.SPATIAL_URL || `http://localhost:${PORT}`;
const HEADED = process.env.HEADED === '1';
const ACCEPTANCE_TIMEOUT_MS = Number(process.env.AI_MAP_UI_ACCEPTANCE_TIMEOUT_MS || 2400000);

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
  return data.token
    ? { token: data.token, expires: data.expires }
    : null;
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
  let serverChild = null;

  if (await isPortOpen(PORT)) killProcessOnPort(PORT);
  serverChild = startSpatialServer(REPO_ROOT);
  const ready = await waitForHttp(`${BASE}/api/spatial/runtime-info`, 90000);
  if (!ready) {
    console.error('Spatial server not ready');
    process.exit(1);
  }

  let preauth = null;
  if (process.env.ARCGIS_USERNAME && process.env.ARCGIS_PASSWORD) {
    preauth = await fetchPreauthToken();
  } else if (!existsSync(AUTH_READY_MARKER)) {
    preauth = await fetchPreauthToken();
  }

  let browser;
  let page;
  if (preauth) {
    browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 40 : 0 });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    await page.addInitScript((tokenData) => {
      window.__MONTREAL_PREAUTH_TOKEN = tokenData;
    }, preauth);
  } else {
    mkdirSync(AUTH_PROFILE_DIR, { recursive: true });
    const context = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
      headless: !HEADED,
      viewport: { width: 1440, height: 900 },
      slowMo: HEADED ? 40 : 0
    });
    page = context.pages()[0] || await context.newPage();
    browser = context;
  }

  await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const mapReady = await waitForMapReady(page, 180000);
  if (!mapReady) {
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'map-not-ready.png'), fullPage: true });
    stopSpatialServer(serverChild);
    console.error('Map not operational for AI MAP UI acceptance');
    process.exit(1);
  }

  const report = await page.evaluate(async (timeoutMs) => {
    const app = window.__IQAI_APP_SHELL__;
    if (!window.__IQAI_RUN_AI_MAP_UI_ACCEPTANCE__) {
      return { state: 'BLOCKED', blocker: 'AI MAP UI harness missing', passed: 0, failed: 1, total: 1, steps: [] };
    }
    const promise = window.__IQAI_RUN_AI_MAP_UI_ACCEPTANCE__(app);
    const timer = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`AI MAP UI acceptance timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([promise, timer]);
  }, ACCEPTANCE_TIMEOUT_MS);

  const screenshotPath = resolve(ARTIFACT_DIR, 'latest.png');
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

  const uiEnabled = await page.evaluate(() => Boolean(window.__IQAI_AI_MAP_UI_ENABLED__));
  const modelBadge = await page.locator('#spatial-ai-model-badge').textContent().catch(() => '');

  const payload = {
    ...report,
    startedAt,
    finishedAt: new Date().toISOString(),
    uiEnabled,
    modelBadge: modelBadge?.trim() || null,
    screenshot: screenshotPath
  };

  writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.txt'), [
    'AGENT 1 AI MAP UI ACCEPTANCE',
    `STATE: ${payload.state}`,
    `UI ENABLED: ${uiEnabled ? 'YES' : 'NO'}`,
    `MODEL BADGE: ${modelBadge || 'n/a'}`,
    `RESULT: ${payload.passed}/${payload.total} passed · ${payload.failed} failed`
  ].join('\n'));

  if (browser?.close) await browser.close();
  stopSpatialServer(serverChild);

  console.log(payload);
  process.exit(payload.state === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
