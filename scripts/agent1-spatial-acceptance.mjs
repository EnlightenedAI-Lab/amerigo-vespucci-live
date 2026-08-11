/**
 * Autonomous Agent 1 deterministic GIS acceptance runner.
 *
 * Automation:
 * - starts/reuses spatial preview server on port 3000
 * - injects ArcGIS token from ARCGIS_USERNAME/ARCGIS_PASSWORD when present
 * - runs the in-browser acceptance matrix via Playwright
 * - writes artifacts/agent1-acceptance/latest.json + latest.txt
 *
 * One-time setup (only if .env credentials absent):
 * - set ARCGIS_USERNAME and ARCGIS_PASSWORD in .env, OR
 * - run with HEADED=1 and complete OAuth once; persistent profile reused at .playwright-auth/montreal
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  isPortOpen,
  killProcessOnPort,
  startSpatialServer,
  waitForHttp,
  stopSpatialServer
} from './lib/spatial-server.mjs';
import {
  A1_HARNESS_VERSION,
  A1_TRANSACTION_VERSION
} from '../public/spatial/a1-runtime-provenance.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-acceptance');
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
const KEEP_SERVER = process.env.KEEP_SERVER === '1';
const FORCE_RESTART = process.env.FORCE_RESTART !== '0';
const ACCEPTANCE_TIMEOUT_MS = Number(process.env.ACCEPTANCE_TIMEOUT_MS || 1800000);

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
  if (!data.token) {
    const message = String(data.error?.message || data.error || data.message || 'ArcGIS token generation failed');
    const details = JSON.stringify(data.error?.details || data.details || '');
    const combined = `${message} ${details}`.toLowerCase();
    if (/multifactor|mfa|two.?factor|second.?factor/.test(combined)) {
      throw new Error('ArcGIS MFA is enabled on the test account — automated token generation is blocked.');
    }
    if (/captcha|recaptcha|robot|challenge/.test(combined)) {
      throw new Error('ArcGIS CAPTCHA challenge required — automated authentication is blocked.');
    }
    if (/consent|approval|authorize/.test(combined)) {
      throw new Error('ArcGIS OAuth consent interaction required — automated authentication is blocked.');
    }
    if (/invalid username or password|wrong password|authentication error|invalid credentials/.test(combined)) {
      throw new Error('ArcGIS credentials rejected — verify ARCGIS_USERNAME/ARCGIS_PASSWORD in .env');
    }
    throw new Error(`ArcGIS token generation failed: ${message}`);
  }
  return {
    token: data.token,
    expires: data.expires
      ? (Number(data.expires) > 1e12 ? Number(data.expires) : Number(data.expires) * 1000)
      : Date.now() + 3600000
  };
}

function gitInfo() {
  try {
    return {
      head: execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
      branch: execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
    };
  } catch {
    return { head: null, branch: null };
  }
}

function formatTextReport(payload) {
  const lines = [
    'AGENT 1 AUTONOMOUS ACCEPTANCE',
    `STATE: ${payload.state}`,
    `BUILD: ${payload.build.harnessVersion} / ${payload.build.transactionVersion}`,
    `GIT: ${payload.git.head || '?'} @ ${payload.git.branch || '?'}`,
    `TIMESTAMP: ${payload.finishedAt || payload.startedAt}`,
    `RESULT: ${payload.passed}/${payload.total} passed · ${payload.failed} failed`,
    '',
    ...payload.steps.map((step) => (
      `${step.pass ? 'PASS' : 'FAIL'} · ${step.label}`
      + (step.durationMs != null ? ` (${Math.round(step.durationMs / 1000)}s)` : '')
      + (step.pass ? '' : ` — ${(step.failures || []).join('; ')}`)
    ))
  ];
  if (payload.blocker) lines.push('', `BLOCKER: ${payload.blocker}`);
  return lines.join('\n');
}

async function waitForMapReady(page, timeoutMs = 120000) {
  return page.waitForFunction(() => {
    const canvas = document.querySelector('#spatial-map-host canvas');
    const layers = document.querySelectorAll('#spatial-layer-tree .layer-row input[type="checkbox"]');
    const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers?.length || 0;
    return Boolean(canvas && layers.length > 0 && catalog > 5);
  }, { timeout: timeoutMs }).catch(() => false);
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const git = gitInfo();
  const build = {
    harnessVersion: A1_HARNESS_VERSION,
    transactionVersion: A1_TRANSACTION_VERSION
  };

  let serverChild = null;
  let startedServer = false;
  const portBusy = await isPortOpen(PORT);
  if (portBusy && FORCE_RESTART) {
    killProcessOnPort(PORT);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const stillBusy = await isPortOpen(PORT);
  if (!stillBusy) {
    serverChild = startSpatialServer(REPO_ROOT);
    startedServer = true;
    const ready = await waitForHttp(`${BASE}/api/spatial/runtime-info`, 90000);
    if (!ready) {
      const payload = {
        startedAt,
        finishedAt: new Date().toISOString(),
        state: 'BLOCKED',
        build,
        git,
        blocker: `Spatial server did not become ready at ${BASE}`,
        passed: 0,
        failed: 0,
        total: 0,
        steps: []
      };
      writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(payload, null, 2));
      writeFileSync(resolve(ARTIFACT_DIR, 'latest.txt'), formatTextReport(payload));
      stopSpatialServer(serverChild);
      process.exit(1);
    }
  }

  let preauth = null;
  let authMode = 'persistent-profile';
  if (process.env.ARCGIS_USERNAME && process.env.ARCGIS_PASSWORD) {
    preauth = await fetchPreauthToken();
    authMode = 'preauth-token';
  } else if (process.env.AUTH_USE_PROFILE === '1' || existsSync(AUTH_READY_MARKER)) {
    authMode = 'persistent-profile';
  } else {
    preauth = await fetchPreauthToken();
    if (preauth) authMode = 'preauth-token';
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

  const payload = {
    startedAt,
    build,
    git,
    baseUrl: BASE,
    authMode,
    repoPath: REPO_ROOT,
    passed: 0,
    failed: 0,
    total: 0,
    steps: [],
    state: 'RUNNING'
  };

  try {
    await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const mapReady = await waitForMapReady(page, 180000);
    if (!mapReady) {
      payload.state = 'BLOCKED';
      payload.blocker = 'Map/catalog not ready after ArcGIS authentication';
      await page.screenshot({ path: resolve(ARTIFACT_DIR, 'auth-needed.png'), fullPage: true });
    } else {
      const runtimeInfo = await page.evaluate(async () => {
        const res = await fetch('/api/spatial/runtime-info', { cache: 'no-store' });
        return res.ok ? res.json() : null;
      });
      payload.runtimeInfo = runtimeInfo;

      const report = await page.evaluate(async (timeoutMs) => {
        const runner = window.__IQAI_RUN_DETERMINISTIC_ACCEPTANCE__;
        if (!runner) throw new Error('Acceptance harness not mounted');
        const promise = runner();
        const timer = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Acceptance matrix timed out after ${timeoutMs}ms`)), timeoutMs);
        });
        return Promise.race([promise, timer]);
      }, ACCEPTANCE_TIMEOUT_MS);

      payload.passed = report.passed;
      payload.failed = report.failed;
      payload.total = report.total;
      payload.steps = report.steps;
      payload.harnessVersion = report.harnessVersion;
      payload.provenance = report.provenance;
      payload.state = report.failed > 0 ? 'BLOCKED' : 'PASS';
      await page.screenshot({ path: resolve(ARTIFACT_DIR, 'acceptance-final.png'), fullPage: true });
    }
  } catch (error) {
    payload.state = 'BLOCKED';
    payload.blocker = error?.message || String(error);
    try {
      await page.screenshot({ path: resolve(ARTIFACT_DIR, 'acceptance-error.png'), fullPage: true });
    } catch {
      // ignore screenshot failure
    }
  } finally {
    payload.finishedAt = new Date().toISOString();
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(payload, null, 2));
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.txt'), formatTextReport(payload));
    if (browser?.close) await browser.close();
    if (startedServer && !KEEP_SERVER) stopSpatialServer(serverChild);
  }

  console.log(formatTextReport(payload));
  process.exit(payload.state === 'PASS' ? 0 : 1);
}

main();
