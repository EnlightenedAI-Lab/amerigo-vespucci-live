/**
 * Authenticated browser acceptance for spatial hardening.
 * Set HEADED=1 to open a visible browser — sign in to ArcGIS when prompted, then tests continue.
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
const HEADED = process.env.HEADED === '1';
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
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#spatial-map-host canvas');
    const layers = document.querySelectorAll('#spatial-layer-tree .layer-row input[type="checkbox"]');
    return Boolean(canvas && layers.length > 0);
  }, { timeout: MANUAL_AUTH_MS }).catch(() => false);
  return page.evaluate(() => {
    const layers = document.querySelectorAll('#spatial-layer-tree .layer-row input[type="checkbox"]');
    return layers.length;
  });
}

async function findLayerCheckbox(page, fragment) {
  const rows = page.locator('#spatial-layer-tree .layer-row');
  const count = await rows.count();
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const text = (await row.textContent()) || '';
    if (text.toLowerCase().includes(fragment.toLowerCase())) {
      return row.locator('input[type="checkbox"]');
    }
  }
  return null;
}

async function runCommand(page, prompt) {
  await page.fill('#spatial-deterministic-input', prompt);
  await page.locator('#spatial-deterministic-run').click({ force: true });
  await page.waitForTimeout(22000);
  return page.evaluate(async () => {
    const inspect = window.__IQAI_RUNTIME_LAYER_INSPECT__ || {};
    const view = window.__IQAI_MAP_VIEW__;
    const group = view?.map?.findLayerById?.('iqai-map-result');
    const layerIds = [];
    if (group?.layers) {
      for (const layer of group.layers) layerIds.push({ id: layer.id, visible: layer.visible, type: layer.type });
    }
    const lastResult = document.querySelector('#spatial-last-operation')?.textContent?.trim() || '';
    const resultsTab = document.querySelector('.context-dock__tab[data-tab="RESULTS"]')?.textContent?.trim() || '';
    const tableMeta = document.querySelector('.results-table-meta')?.textContent?.trim() || '';
    const provenanceOpen = document.querySelector('#spatial-provenance-details')?.open ?? null;
    return {
      inspect,
      groupVisible: group?.visible ?? null,
      childLayers: layerIds,
      lastResult,
      resultsTab,
      tableMeta,
      provenanceOpen,
      mapReady: Boolean(view?.map)
    };
  });
}

const report = { base: BASE, headed: HEADED };

const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 80 : 0 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const preauth = await fetchPreauthToken();
if (preauth) {
  await page.addInitScript((tokenData) => {
    window.__MONTREAL_PREAUTH_TOKEN = tokenData;
  }, preauth);
}

await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 90000 });

if (HEADED && !preauth) {
  console.log(`Sign in to ArcGIS in the browser window. Waiting up to ${MANUAL_AUTH_MS / 1000}s…`);
  await page.waitForTimeout(5000);
}

const layerCount = await waitForMapReady(page);
report.mapReady = layerCount > 0;
report.layerCheckboxCount = layerCount;

if (!report.mapReady) {
  report.error = 'Map/layers not ready — sign in and reload, or set ARCGIS_USERNAME/ARCGIS_PASSWORD in .env';
  await page.screenshot({ path: resolve(ARTIFACTS, 'verify-regression-auth-needed.png') });
  writeFileSync(resolve(ARTIFACTS, 'verify-regression-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(1);
}

report.amenities = await runCommand(page, 'map amenities within 3km of 997 de la commune');
await page.screenshot({ path: resolve(ARTIFACTS, 'verify-regression-amenities.png') });

report.fireStations = await runCommand(page, 'map fire stations within 3km of 997 de la commune');
await page.screenshot({ path: resolve(ARTIFACTS, 'verify-regression-fire-stations.png') });

const ports = await findLayerCheckbox(page, 'Ports');
if (ports) {
  const before = await ports.isChecked();
  await ports.click({ force: true });
  await page.waitForTimeout(1500);
  const after = await ports.isChecked();
  report.portsToggle = { before, after, changed: before !== after };
}

const controlsBox = await page.locator('.spatial-map-controls').boundingBox();
report.widgets = { controlsHeight: controlsBox?.height ?? null, compact: (controlsBox?.height ?? 999) < 200 };

report.rightRail = await page.evaluate(() => ({
  provenanceOpen: document.querySelector('#spatial-provenance-details')?.open ?? null,
  lastResultVisible: !document.querySelector('#spatial-last-operation-section')?.hidden,
  helperVisible: !document.querySelector('#spatial-intel-helper')?.hidden
}));

await page.screenshot({ path: resolve(ARTIFACTS, 'verify-regression-widgets-rail.png') });

writeFileSync(resolve(ARTIFACTS, 'verify-regression-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
