/**
 * Browser acceptance: deterministic query features must be visibly drawn.
 * Requires ARCGIS_USERNAME/ARCGIS_PASSWORD in .env or manual sign-in (HEADED=1).
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = resolve(__dirname, '../artifacts');

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

loadEnvFile(resolve(__dirname, '../.env'));

const BASE = process.env.SPATIAL_URL || 'http://localhost:3000';
const HEADED = process.env.HEADED !== '0';
const MANUAL_AUTH_MS = Number(process.env.MANUAL_AUTH_MS || 120000);

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
  const data = await res.json();
  if (!data.token) return null;
  return { token: data.token, expires: data.expires ? Number(data.expires) * 1000 : Date.now() + 3600000 };
}

async function waitForMapReady(page) {
  return page.waitForFunction(() => {
    const canvas = document.querySelector('#spatial-map-host canvas');
    const layers = document.querySelectorAll('#spatial-layer-tree .layer-row input[type="checkbox"]');
    return Boolean(canvas && layers.length > 0);
  }, { timeout: MANUAL_AUTH_MS }).catch(() => false);
}

async function runCommand(page, prompt) {
  await page.fill('#spatial-deterministic-input', prompt);
  await page.locator('#spatial-deterministic-run').click({ force: true });
  await page.waitForTimeout(25000);
  return page.evaluate(async () => {
    const inspect = window.__IQAI_RUNTIME_LAYER_INSPECT__?.['iqai-deterministic-results'] || {};
    const samples = window.__IQAI_GEOMETRY_SAMPLES__ || [];
    const resultsTab = document.querySelector('.context-dock__tab[data-tab="RESULTS"]')?.textContent?.trim() || '';
    const tableMeta = document.querySelector('.results-table-meta')?.textContent?.trim() || '';
    const lastCount = document.querySelector('.detail-last-result__count')?.textContent?.trim() || '';
    const errors = [];
    return { inspect, samples, resultsTab, tableMeta, lastCount, errors };
  });
}

const report = { base: BASE, headed: HEADED };

const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 60 : 0 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const preauth = await fetchPreauthToken();
if (preauth) {
  await page.addInitScript((tokenData) => {
    window.__MONTREAL_PREAUTH_TOKEN = tokenData;
  }, preauth);
}

await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 90000 });

if (HEADED && !preauth) {
  console.log(`Sign in to ArcGIS if prompted. Waiting up to ${MANUAL_AUTH_MS / 1000}s…`);
}

const mapReady = await waitForMapReady(page);
report.mapReady = Boolean(mapReady);

if (!mapReady) {
  report.error = 'Map not ready — sign in or set ARCGIS_USERNAME/ARCGIS_PASSWORD';
  await page.screenshot({ path: resolve(ARTIFACTS, 'verify-deterministic-auth-needed.png') });
  writeFileSync(resolve(ARTIFACTS, 'verify-deterministic-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(1);
}

report.amenities = await runCommand(page, 'map amenities within 3km of 997 de la commune');
await page.screenshot({ path: resolve(ARTIFACTS, 'verify-deterministic-amenities.png'), fullPage: false });

report.fireStations = await runCommand(page, 'map fire stations within 3km of 997 de la commune');
await page.screenshot({ path: resolve(ARTIFACTS, 'verify-deterministic-fire-stations.png'), fullPage: false });

const amenityInspect = report.amenities?.inspect || {};
report.pass = {
  amenitiesVisible: (amenityInspect.queryFeatureCount || amenityInspect.layerQueryFeatureCount || 0) >= 100,
  amenitiesOnMap: amenityInspect.mapLayersIncludes === true,
  amenitiesRenderer: amenityInspect.rendererType === 'simple',
  fireVisible: (report.fireStations?.inspect?.queryFeatureCount || 0) > 0
};

writeFileSync(resolve(ARTIFACTS, 'verify-deterministic-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!report.pass.amenitiesVisible) process.exit(2);
