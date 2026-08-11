#!/usr/bin/env node
/**
 * Reliability top bar browser proof — requires live :3000/spatial/
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPortOpen } from './lib/spatial-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-reliability-top-bar-v1');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');
const QUERY = 'Find officially reported firearm incidents in Montréal in the last 30 days and map only admissible events.';
const PORT = Number(process.env.SPATIAL_PORT || 3000);
const SPATIAL_URL = `http://localhost:${PORT}/spatial/`;
const RESEARCH_TIMEOUT_MS = Number(process.env.INTEL_RESEARCH_TIMEOUT_MS || 240000);
const SETTLE_MS = Number(process.env.SCENARIO_SETTLE_MS || 15000);

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

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  const portal = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  if (!username || !password) return null;
  const params = new URLSearchParams({ username, password, client: 'requestip', f: 'json', expiration: '60' });
  const res = await fetch(`${portal}/sharing/rest/generateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json();
  if (!data.token) return null;
  return { token: data.token, expires: Date.now() + 3600000 };
}

async function waitForReady(page) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const snap = await page.evaluate(async () => ({
      canvas: Boolean(document.querySelector('#spatial-map-host canvas')),
      catalog: window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers?.length || 0,
      topBarHost: Boolean(document.querySelector('#spatial-reliability-top-bar'))
    }));
    if (snap.canvas && snap.catalog > 5 && snap.topBarHost) return snap;
    await page.waitForTimeout(1000);
  }
  throw new Error('Runtime not ready');
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  if (!(await isPortOpen(PORT))) {
    console.log(JSON.stringify({ pass: false, error: 'Port not open' }, null, 2));
    process.exit(1);
  }

  const preauth = (process.env.ARCGIS_USERNAME && process.env.ARCGIS_PASSWORD)
    ? await fetchPreauthToken()
    : null;
  let browser;
  let context;
  if (preauth) {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((tokenData) => { window.__MONTREAL_PREAUTH_TOKEN = tokenData; }, preauth);
  } else {
    mkdirSync(AUTH_PROFILE_DIR, { recursive: true });
    context = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
      headless: true,
      viewport: { width: 1440, height: 900 }
    });
  }

  const page = context.pages()[0] || await context.newPage();
  const artifact = { pass: false, query: QUERY };

  try {
    await page.goto(`${SPATIAL_URL}?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitForReady(page);

    const responseWait = page.waitForResponse(
      (res) => res.url().includes('/api/spatial/orchestrator/progressive-intelligence') && res.request().method() === 'POST',
      { timeout: RESEARCH_TIMEOUT_MS }
    );
    await page.evaluate(async (text) => {
      await window.__IQAI_APP_SHELL__?.runAiMapCommand(text);
    }, QUERY);
    await responseWait;
    await page.waitForFunction(() => window.__IQAI_RELIABILITY_TOP_BAR__?.mode === 'INTELLIGENCE_RUN', { timeout: RESEARCH_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);

    artifact.topBar = await page.evaluate(() => window.__IQAI_RELIABILITY_TOP_BAR__ || null);
    artifact.topBarDom = await page.evaluate(() => document.querySelector('.reliability-top-bar')?.textContent || null);
    const server = await fetch(`http://localhost:${PORT}/api/spatial/ai-map/last-receipt`, { cache: 'no-store' }).then((r) => r.json());
    artifact.serverReceipt = server.receipt || null;

    const pillMap = Object.fromEntries((artifact.topBar?.pills || []).map((p) => [p.key, p.value]));
    artifact.pass = Boolean(
      artifact.topBar?.mode === 'INTELLIGENCE_RUN'
      && pillMap.SOURCES
      && pillMap.GOVERNED != null
      && pillMap.GOVERNANCE
      && pillMap.MAPPED != null
      && (pillMap.REASON || pillMap.GOVERNANCE === 'NO CANDIDATES')
      && (pillMap.TIME || pillMap.REASON)
      && artifact.serverReceipt
      && String(pillMap.GOVERNED) === String(artifact.serverReceipt.governedCandidateCount)
      && String(pillMap.SOURCES) === String(artifact.serverReceipt.sourceResultCount)
    );
  } catch (error) {
    artifact.error = error.message;
  } finally {
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(artifact, null, 2));
    if (browser) await browser.close().catch(() => {});
    else await context.close().catch(() => {});
  }

  console.log(JSON.stringify(artifact, null, 2));
  process.exit(artifact.pass ? 0 : 1);
}

main();
