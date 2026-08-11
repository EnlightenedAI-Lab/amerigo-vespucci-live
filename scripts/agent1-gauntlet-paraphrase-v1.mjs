#!/usr/bin/env node
/** Anti-overfit paraphrase checks for gauntlet levels 1-3. */
import { chromium } from 'playwright';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSpatialServer, stopSpatialServer, waitForHttp, isPortOpen, killProcessOnPort } from './lib/spatial-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-iqai-operator-gauntlet-v1');
const PORT = 3000;
const BASE = `http://localhost:${PORT}`;

function loadEnv() {
  const envPath = resolve(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

loadEnv();
process.env.IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED = 'true';
process.env.IQAI_PLACE_POI_V1_ENABLED = 'true';

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  if (!username || !password) return null;
  const params = new URLSearchParams({ username, password, client: 'requestip', expiration: '60', f: 'json' });
  const res = await fetch('https://www.arcgis.com/sharing/rest/generateToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json().catch(() => ({}));
  return data.token ? { token: data.token } : null;
}

async function runPrompt(page, prompt, waitPoi = false) {
  await page.waitForFunction(() => {
    const btn = document.querySelector('#spatial-ai-run');
    const field = document.querySelector('#spatial-ai-input');
    return field && !field.disabled && btn && btn.textContent?.trim() !== '…';
  }, { timeout: 180000 });
  const input = page.locator('#spatial-ai-input');
  await input.fill(prompt);
  const waits = [];
  if (waitPoi) waits.push(page.waitForResponse((r) => r.url().includes('/place-poi/search') && r.request().method() === 'POST', { timeout: 120000 }).catch(() => null));
  await page.locator('#spatial-ai-run').click();
  if (waits.length) await Promise.all(waits);
  await page.waitForFunction(() => {
    const btn = document.querySelector('#spatial-ai-run');
    const field = document.querySelector('#spatial-ai-input');
    return field && !field.disabled && btn && btn.textContent?.trim() !== '…';
  }, { timeout: 180000 });
  await page.waitForTimeout(waitPoi ? 8000 : 15000);
  return page.evaluate(() => ({
    chain: document.querySelector('#spatial-ai-chain')?.textContent?.trim() || '',
    feedback: document.querySelector('#spatial-ai-feedback')?.textContent?.trim() || '',
    arcgis: window.__IQAI_LAST_ARCGIS_DISCOVERY__ || null
  }));
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  if (await isPortOpen(PORT)) killProcessOnPort(PORT);
  const server = startSpatialServer(REPO_ROOT);
  if (!await waitForHttp(`${BASE}/api/spatial/runtime-info`, 90000)) process.exit(1);
  const preauth = await fetchPreauthToken();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  if (preauth) await page.addInitScript((t) => { window.__MONTREAL_PREAUTH_TOKEN = t; }, preauth);
  await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(document.querySelector('#spatial-map-host canvas')), { timeout: 120000 });

  const cases = [
    { level: 1, prompt: 'Show me fire stations within 3 km of 997 de la Commune.', expect: /Deterministic GIS|fire station/i },
    { level: 2, prompt: 'Show me the five pharmacies closest to 997 de la Commune.', expect: /Place POI|pharmac/i, waitPoi: true },
    { level: 3, prompt: "Put Montréal's borough boundaries on the map from an authoritative ArcGIS source.", expect: /ArcGIS discovery/i }
  ];
  const results = {};
  for (const c of cases) {
    const snap = await runPrompt(page, c.prompt, c.waitPoi);
    results[c.level] = {
      prompt: c.prompt,
      pass: c.expect.test(`${snap.chain} ${snap.feedback}`) && (c.level !== 3 || snap.arcgis?.authority?.authorityWeight >= 65),
      chain: snap.chain,
      feedback: snap.feedback,
      authorityWeight: snap.arcgis?.authority?.authorityWeight ?? null
    };
  }
  writeFileSync(resolve(ARTIFACT_DIR, 'paraphrase.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
  stopSpatialServer(server);
  process.exit(Object.values(results).every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
